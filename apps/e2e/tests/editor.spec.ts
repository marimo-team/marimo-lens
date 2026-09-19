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

test("collapsed Lens matches Marimo controls while remaining draggable", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const lens = page.getByRole("button", { name: "Open Lens", exact: true });
  const grip = lens.locator("[data-marimo-lens-collapsed-grip]");
  await expect
    .poll(() => grip.evaluate((element) => getComputedStyle(element).opacity))
    .toBe("0.64");
  const save = page.locator('[data-testid="save-button"]');
  const styles = await Promise.all([
    lens.evaluate((element) => {
      const surface = getComputedStyle(element, "::before");
      const gripElement = element.querySelector<HTMLElement>("[data-marimo-lens-collapsed-grip]");
      if (!gripElement) throw new Error("Collapsed Lens grip is missing");
      const grip = getComputedStyle(gripElement);
      const bounds = element.getBoundingClientRect();
      const gripBounds = gripElement.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        borderColor: surface.borderColor,
        borderRadius: surface.borderRadius,
        shadow: surface.boxShadow,
        cursor: getComputedStyle(element).cursor,
        grip: {
          width: grip.width,
          opacity: grip.opacity,
          outside: gripBounds.right <= bounds.left,
        },
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
    cursor: "grab",
    grip: { width: "14px", opacity: "0.64", outside: true },
  });
  expect(lensStyle.shadow).toContain("1px 1px 0px");
  expect(marimoStyle.shadow).toContain("1px 1px 0px");
  await screenshot(page, testInfo, "collapsed-native-control");
});
