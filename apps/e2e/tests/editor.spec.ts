import { expect } from "@playwright/test";

import { runAction, screenshot, selectOutput, test } from "./support";

test("editor output selections expose notes, producing cells, and PNGs to the kernel", async ({
  page,
}, testInfo) => {
  await selectOutput(page, "point", "S1", "Explain February in the editor");
  const report = await runAction(page);
  const selection = report.references.selections[0];
  expect(selection).toMatchObject({
    label: "S1",
    note: "Explain February in the editor",
    target: { kind: "notebook" },
    anchor: { kind: "point" },
    snapshot: { status: "available" },
  });
  expect(selection.target.cellIds).toHaveLength(1);
  expect(selection.cells).toEqual([{ id: selection.target.cellIds[0], status: "available" }]);
  expect(report.images[selection.id].signature).toBe("89504e470d0a1a0a");
  expect(report.images[selection.id].bytes).toBeGreaterThan(100);
  expect(report.text).toContain("Revenue by month");
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await screenshot(page, testInfo, "editor-selection");
});
