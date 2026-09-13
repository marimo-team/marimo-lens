import { expect } from "@playwright/test";

import { runAction, selectOutput, test } from "./support";

test("separate notebook sessions keep annotations and images isolated", async ({
  page,
  browser,
}) => {
  await selectOutput(page, "point", "S1", "First notebook session");
  const first = await runAction(page);
  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const other = await otherContext.newPage();
    const errors: string[] = [];
    other.on("pageerror", (error) => errors.push(error.message));
    await other.goto("/");
    await expect(other.getByRole("button", { name: "Select a target", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect((await runAction(other)).references.selections).toEqual([]);
    await selectOutput(other, "region", "S1", "Second notebook session");
    const second = await runAction(other);
    expect(second.references.selections[0].id).not.toBe(first.references.selections[0].id);
    expect(Object.keys(second.images)).not.toContain(first.references.selections[0].id);
    await runAction(other, "Resolve");
    expect((await runAction(page)).references).toMatchObject({
      revision: first.references.revision,
      selections: first.references.selections,
    });
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
  }
  expect((await runAction(page)).images).toEqual(first.images);
});
