import { expect } from "@playwright/test";

import { runAction, selectOutput, test } from "./support";

test("reduced motion preserves control geometry while pressed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await selectOutput(page, "point", "S1", "Check this month");
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await page.getByRole("button", { name: "Edit note for S1", exact: true }).click();
  await page.getByRole("dialog", { name: /Edit note for S1/ }).evaluate(async (dialog) => {
    await Promise.all(
      dialog.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  const control = page.getByRole("button", { name: "Done", exact: true });
  const resting = await control.boundingBox();
  if (!resting) throw new Error("Selection control is unavailable");
  await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height / 2);
  await page.mouse.down();
  try {
    await expect(control).toHaveJSProperty("disabled", false);
    expect(await control.evaluate((element) => element.matches(":active"))).toBe(true);
    await control.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const pressed = await control.boundingBox();
    expect(pressed).toEqual(resting);
  } finally {
    await page.mouse.up();
  }
});

test.describe("touch controls", () => {
  test.use({ hasTouch: true });

  test("clear and reopen selections retain usable touch targets", async ({ page }) => {
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await selectOutput(page, "point", "S1", "Check this month");
    await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
    const clear = page.getByRole("button", { name: "Clear selections", exact: true });
    await expect(clear).toBeVisible();
    expect((await clear.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Close selections" }).click();
    await runAction(page, "Resolve");
    await page.getByRole("button", { name: "Open selections, 0 open, 1 in history" }).click();
    await page.getByRole("tab", { name: /History/ }).click();
    const reopen = page.getByRole("button", { name: "Reopen S1", exact: true });
    await expect(reopen).toBeVisible();
    expect((await reopen.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });
});

test("busy point and region markers dim consistently during note saves", async ({ page }) => {
  await selectOutput(page, "point", "S1", "Check this month");
  await selectOutput(page, "region", "S2", "Check the quarter");
  for (const label of ["S1", "S2"]) {
    await page.getByRole("button", { name: "Open selections, 2 open, 0 in history" }).click();
    await page.getByRole("button", { name: `Edit note for ${label}`, exact: true }).click();
    const editor = page.getByRole("dialog", { name: new RegExp(`Edit note for ${label}`) });
    await editor.getByRole("textbox").fill(`Updated ${label}`);
    // Hold the command before it reaches Python so the actual pending UI stays visible.
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const endpoint = "**/api/kernel/set_model_value";
    await page.route(endpoint, async (route) => {
      await pending;
      await route.continue();
    });
    try {
      await editor.getByRole("button", { name: "Done", exact: true }).click({ noWaitAfter: true });
      const marker = page.getByRole("button", {
        name: `Current selection ${label}. Drag to adjust.`,
        exact: true,
        includeHidden: true,
      });
      await expect(marker).toBeDisabled();
      await expect(marker).toHaveAttribute("data-busy", "true");
      const opacity = await marker.evaluate((element) => {
        let effective = 1;
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          effective *= Number(getComputedStyle(ancestor).opacity);
        }
        return effective;
      });
      expect(opacity).toBeCloseTo(0.6);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(editor).toBeHidden();
  }
});
