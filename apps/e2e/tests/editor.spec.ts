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

test("Marimo dialogs cover Lens selection markers", async ({ page }, testInfo) => {
  await selectOutput(page, "point", "S1", "Check dialog stacking");
  await page.getByRole("region", { name: "Revenue by month" }).evaluate((target) => {
    target.scrollIntoView({ block: "center" });
  });
  await page.getByTestId("notebook-menu-dropdown").click();
  await page.getByTestId("notebook-menu-dropdown-Pair with an agent").click();

  const dialog = page.getByRole("dialog", { name: "Pair with an agent" });
  const marker = page.locator("[data-marimo-lens-selection-id]");
  await expect(dialog).toBeVisible();
  await expect(marker).toBeVisible();

  const dialogBounds = (await dialog.boundingBox())!;
  const markerBounds = (await marker.boundingBox())!;
  const x = markerBounds.x + markerBounds.width / 2;
  const y = markerBounds.y + markerBounds.height / 2;
  expect(x).toBeGreaterThan(dialogBounds.x);
  expect(x).toBeLessThan(dialogBounds.x + dialogBounds.width);
  expect(y).toBeGreaterThan(dialogBounds.y);
  expect(y).toBeLessThan(dialogBounds.y + dialogBounds.height);
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="dialog"]') !== null,
      { x, y },
    ),
  ).toBe(true);
  await screenshot(page, testInfo, "dialog-over-selection");
});

test("collapsed Lens matches Marimo controls while remaining draggable", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const lens = page.getByRole("button", { name: "Open Lens", exact: true });
  const grip = lens.locator("[data-marimo-lens-collapsed-grip]");
  await expect(grip).toBeVisible();
  const save = page.locator('[data-testid="save-button"]');
  const styles = await Promise.all([
    lens.evaluate((element) => {
      const surface = getComputedStyle(element, "::before");
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        borderColor: surface.borderColor,
        borderRadius: surface.borderRadius,
        shadow: surface.boxShadow,
      };
    }),
    save.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        shadow: style.boxShadow,
      };
    }),
  ]);
  const [lensStyle, marimoStyle] = styles;

  expect(Math.abs(lensStyle.width - marimoStyle.width)).toBeLessThan(3);
  expect(Math.abs(lensStyle.height - marimoStyle.height)).toBeLessThan(3);
  expect(
    Math.abs(
      Number.parseFloat(lensStyle.borderRadius) - Number.parseFloat(marimoStyle.borderRadius),
    ),
  ).toBeLessThan(1);
  expect(lensStyle).toMatchObject({
    borderColor: marimoStyle.borderColor,
  });
  expect(marimoStyle.shadow).toContain(lensStyle.shadow);
  await screenshot(page, testInfo, "collapsed-native-control");
  const dock = page.locator("[data-marimo-lens-dock]");
  const before = (await dock.boundingBox())!;
  const handle = (await grip.boundingBox())!;
  const button = (await lens.boundingBox())!;
  expect(handle.x + handle.width).toBeLessThanOrEqual(button.x);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 90, handle.y - 100, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await dock.boundingBox())!.x).toBeGreaterThan(before.x + 70);
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeLessThan(before.y - 70);
  await expect(lens).toBeVisible();
  await lens.click();
  await expect(page.getByRole("button", { name: "Move Lens", exact: true })).toBeVisible();
});
