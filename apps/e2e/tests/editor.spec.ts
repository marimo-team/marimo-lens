import { expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

import { drag, runAction, screenshot, selectOutput, test } from "./support";

test.describe("a Lens without a record", () => {
  test.use({ record: false });

  test("closes a resolved selection with a dismissible receipt and writes no record", async ({
    page,
    notebook,
  }, testInfo) => {
    await selectOutput(page, "point", "S1", "Explain February without a record");
    const report = await runAction(page);
    expect(report.references.notebook.record).toBeNull();
    await page.getByRole("button", { name: "Requests, 1 open", exact: true }).click();
    const sheet = page.getByRole("region", { name: "Requests", exact: true });
    await expect(sheet.getByRole("tab", { name: /^Open/ })).toBeVisible();
    await expect(sheet.getByRole("tab", { name: /History/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Close requests" }).click();
    await expect(sheet).toBeHidden();

    const resolved = await runAction(page, "Resolve");
    expect(resolved.error).toBeNull();
    expect(resolved.references.selections).toEqual([]);
    const receipt = page
      .locator("[data-marimo-lens-dock]")
      .getByRole("button", { name: "Dismiss receipt for S1", exact: true });
    await expect(receipt).toBeVisible();
    await expect(receipt).toHaveAttribute("data-selection-id", report.references.selections[0].id);
    await expect(receipt).toContainText("Checked the revenue totals");
    await screenshot(page, testInfo, "receipt-without-record");
    // Pointer interaction pauses the receipt's timeout, so only the click dismisses it.
    await receipt.click();
    await expect(receipt).toBeHidden();
    await expect(sheet).toBeHidden();
    await expect(access(join(dirname(notebook), "__marimo__", "lens"))).rejects.toThrow();
  });
});

test("editor selections reference a cell without output through its code", async ({ page }) => {
  const line = page.locator(".cm-line", { hasText: "reporting_months = " });
  await selectOutput(page, "point", "S1", "In this cell, add April", line);
  const report = await runAction(page);
  const selection = report.references.selections[0];
  expect(selection).toMatchObject({
    label: "S1",
    target: { kind: "notebook" },
    anchor: { kind: "point" },
    snapshot: { status: "available" },
  });
  // marimo's host protocol names the cell's code by this `code_hash`.
  const code = 'reporting_months = ["January", "February", "March"]';
  const codeHash = createHash("sha256").update(code).digest("hex").slice(0, 16);
  expect(selection.cells).toEqual([
    { id: selection.target.cellIds[0], status: "available", codeHash },
  ]);
  expect(report.text).toContain("In this cell, add April");
  expect(report.text).toContain('reporting_months = ["January", "February", "March"]');
});

test("fullscreen region selections keep the inline cell, note, and image", async ({
  page,
}, testInfo) => {
  const chart = page.getByRole("region", { name: "Revenue by month" });
  const output = page.locator('[id^="output-"]', { has: chart });
  const cellId = (await output.getAttribute("id"))!.slice("output-".length);
  const cell = page.locator("[data-cell-id]", { has: chart });
  await selectOutput(page, "point", "S1", "Inline attention");
  await chart.hover();
  await cell.getByTestId("fullscreen-output-button").click();
  await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();

  await selectOutput(page, "region", "S2", "Review this fullscreen region");
  await page.getByRole("button", { name: "Requests, 2 open, 0 in history" }).click();
  await expect(page.getByText("Review this fullscreen region", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "fullscreen-region-selection");
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();

  await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeHidden();
  await expect(page.locator("[data-marimo-lens-selection-id]")).toHaveCount(2);
  const report = await runAction(page);
  expect(report.references.selections).toHaveLength(2);
  const [inline, fullscreen] = report.references.selections;
  expect(fullscreen).toMatchObject({
    label: "S2",
    note: "Review this fullscreen region",
    target: { kind: "notebook", cellIds: [cellId] },
    anchor: { kind: "rect" },
    snapshot: { status: "available" },
  });
  expect(fullscreen.target).toEqual(inline.target);
  expect(fullscreen.cells).toEqual([
    { id: cellId, status: "available", codeHash: expect.stringMatching(/^[0-9a-f]{16}$/) },
  ]);
  expect(report.images[fullscreen.id].signature).toBe("89504e470d0a1a0a");
  expect(report.images[fullscreen.id].bytes).toBeGreaterThan(100);

  await chart.evaluate((target) => target.scrollIntoView({ block: "center" }));
  await chart.hover();
  await cell.getByTestId("fullscreen-output-button").click();
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page.getByRole("button", { name: "Cancel selection mode", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
});

test("fullscreen hides other cells' markers and keeps keyboard selection on its output", async ({
  page,
}) => {
  const chart = page.getByRole("region", { name: "Revenue by month" });
  const output = page.locator('[id^="output-"]', { has: chart });
  const cellId = (await output.getAttribute("id"))!.slice("output-".length);
  await selectOutput(
    page,
    "point",
    "S1",
    "Keep this inline note",
    page.getByRole("heading", { name: "Regional revenue", exact: true }),
  );
  await chart.evaluate((target) => target.scrollIntoView({ block: "center" }));
  await chart.hover();
  await page
    .locator("[data-cell-id]", { has: chart })
    .getByTestId("fullscreen-output-button")
    .click();
  await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
  await expect(page.locator("[data-marimo-lens-selection-id]")).toHaveCount(0);

  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: /Add note for S2/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox").fill("Keyboard attention on the fullscreen output");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator("[data-marimo-lens-selection-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await expect(page.locator("[data-marimo-lens-selection-id]")).toHaveCount(2);

  const report = await runAction(page);
  expect(report.references.selections).toHaveLength(2);
  expect(report.references.selections[0].note).toBe("Keep this inline note");
  expect(report.references.selections[0].target.cellIds).not.toEqual([cellId]);
  expect(report.references.selections[1]).toMatchObject({
    note: "Keyboard attention on the fullscreen output",
    target: { kind: "notebook", cellIds: [cellId] },
    anchor: { kind: "point" },
    snapshot: { status: "available" },
  });
});

test("Marimo dialogs cover Lens selection markers", async ({ page }, testInfo) => {
  await selectOutput(page, "point", "S1", "Check dialog stacking");
  await page.getByRole("region", { name: "Revenue by month" }).evaluate((target) => {
    target.scrollIntoView({ block: "center" });
  });
  await page.getByTestId("notebook-menu-dropdown").click();
  await page.getByRole("menuitem", { name: "Connect your agent" }).click();

  const dialog = page.getByRole("dialog", { name: "Pair with an agent" });
  const marker = page.locator("[data-marimo-lens-selection-id]");
  await expect(dialog).toBeVisible();
  await expect(marker).toBeVisible();
  await dialog.evaluate(async (surface) => {
    await Promise.all(
      surface.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });

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
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="dialog"]') != null,
      { x, y },
    ),
  ).toBe(true);
  await screenshot(page, testInfo, "dialog-over-selection");
});

test("Marimo sidebar clips a straddling region and its handles", async ({ page }, testInfo) => {
  await selectOutput(page, "region", "S1", "Check application chrome");
  await openSidebarAndStraddleSelection(page, "rect");
  await expectLensClippedByApp(page, "rect");
  await screenshot(page, testInfo, "sidebar-bounds-lens");
});

test("Marimo sidebar clips a point marker at the pane edge", async ({ page }, testInfo) => {
  await selectOutput(page, "point", "S1", "Check point clipping");
  await openSidebarAndStraddleSelection(page, "point");
  await expectLensClippedByApp(page, "point");
  await screenshot(page, testInfo, "sidebar-bounds-point");
});

test("collapsed Lens matches Marimo controls while remaining draggable", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const lens = page.getByRole("button", { name: "Expand Lens", exact: true });
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
  await drag(page, handle, { x: handle.x + 90, y: handle.y - 100 }, 10);
  await expect.poll(async () => (await dock.boundingBox())!.x).toBeGreaterThan(before.x + 70);
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeLessThan(before.y - 70);
  await expect(lens).toBeVisible();
  await lens.click();
  await expect(page.getByRole("button", { name: "Move Lens", exact: true })).toBeVisible();
});

async function openSidebarAndStraddleSelection(
  page: import("@playwright/test").Page,
  kind: "point" | "rect",
) {
  await page
    .locator('[aria-label="Sidebar panels"] [role="option"]')
    .first()
    .click({ noWaitAfter: true });
  await expect
    .poll(async () => (await page.getByTestId("helper").boundingBox())?.width ?? 0)
    .toBeGreaterThan(200);
  await page.getByRole("region", { name: "Revenue by month" }).evaluate(
    (target, shift) => {
      const output = target.closest<HTMLElement>('[id^="output-"]');
      if (!output) throw new Error("Revenue output root is unavailable");
      output.style.width = `calc(100% + ${shift}px)`;
      output.style.transform = `translateX(-${shift}px)`;
    },
    kind === "rect" ? 450 : 410,
  );
}

async function expectLensClippedByApp(
  page: import("@playwright/test").Page,
  kind: "point" | "rect",
) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const app = document.getElementById("App");
        const portal = document.querySelector<HTMLElement>("[data-marimo-lens-portal]");
        const shadow = portal?.shadowRoot;
        const dock = shadow?.querySelector<HTMLElement>("[data-marimo-lens-dock]");
        const marker = shadow?.querySelector<HTMLElement>("[data-marimo-lens-selection-id]");
        if (!app || !portal || !shadow || !dock || !marker) return null;
        const pane = app.getBoundingClientRect();
        const dockBounds = dock.getBoundingClientRect();
        const markerBounds = marker.getBoundingClientRect();
        const y = markerBounds.top + markerBounds.height / 2;
        const lensOwns = (x: number, atY: number) =>
          document.elementFromPoint(x, atY)?.closest("[data-marimo-lens-ui]") != null;
        const handles = [...shadow.querySelectorAll<HTMLElement>("[data-handle]")].map((handle) => {
          const bounds = handle.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const handleY = bounds.top + bounds.height / 2;
          return { x, y: handleY, inPane: x > pane.left && x < pane.right };
        });
        return {
          portalInApp: portal.parentElement === app,
          dockInside:
            dockBounds.left >= pane.left &&
            dockBounds.right <= pane.right &&
            dockBounds.top >= pane.top &&
            dockBounds.bottom <= pane.bottom,
          straddles: markerBounds.left < pane.left && markerBounds.right > pane.left,
          chromeOwnsHiddenSide: !lensOwns(pane.left - 4, y),
          hiddenHandlesClipped: handles
            .filter(({ inPane }) => !inPane)
            .every(({ x, y: handleY }) => !lensOwns(x, handleY)),
          hiddenHandles: handles.filter(({ inPane }) => !inPane).length,
        };
      }),
    )
    .toEqual({
      portalInApp: true,
      dockInside: true,
      straddles: true,
      chromeOwnsHiddenSide: true,
      hiddenHandlesClipped: true,
      hiddenHandles: kind === "rect" ? 2 : 0,
    });

  // Lens UI outside the pane misses hit testing even where it paints, so
  // compare pixels: the sidebar strip at the pane edge renders the same with
  // the Lens root transparent.
  const strip = await page.evaluate(() => {
    const pane = document.getElementById("App")!.getBoundingClientRect();
    const marker = document
      .querySelector("[data-marimo-lens-portal]")!
      .shadowRoot!.querySelector("[data-marimo-lens-selection-id]")!
      .getBoundingClientRect();
    const y = Math.floor(marker.top) - 24;
    return {
      x: Math.floor(pane.left) - 21,
      y,
      width: 20,
      height: Math.ceil(marker.bottom) + 8 - y,
    };
  });
  const root = page.locator("[data-marimo-lens-root]");
  const withLens = await page.screenshot({ clip: strip });
  await root.evaluate((element: HTMLElement) =>
    element.style.setProperty("opacity", "0", "important"),
  );
  const withoutLens = await page.screenshot({ clip: strip });
  await root.evaluate((element: HTMLElement) => element.style.removeProperty("opacity"));
  expect(withLens.equals(withoutLens)).toBe(true);
}
