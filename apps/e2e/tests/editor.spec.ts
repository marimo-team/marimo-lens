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
  expect(selection.cells).toEqual([{ id: selection.target.cellIds[0], status: "available" }]);
  expect(report.text).toContain("In this cell, add April");
  expect(report.text).toContain('reporting_months = ["January", "February", "March"]');
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

test("in-pane Marimo chrome covers Lens markers", async ({ page }, testInfo) => {
  await selectOutput(page, "point", "S1", "Check in-pane stacking");
  const marker = page.locator("[data-marimo-lens-selection-id]");
  const bounds = await marker.boundingBox();
  if (!bounds) throw new Error("Selection marker is unavailable");
  await page.evaluate(({ x, y, width, height }) => {
    const app = document.getElementById("App");
    if (!app) throw new Error("Marimo app pane is unavailable");
    const chrome = document.createElement("div");
    chrome.dataset.testid = "in-pane-chrome";
    chrome.textContent = "Marimo chrome";
    chrome.style.cssText = `position:fixed;z-index:1000;left:${x}px;top:${y}px;width:${width}px;height:${height}px;background:white`;
    app.append(chrome);
  }, bounds);

  expect(
    await page.evaluate(
      ({ x, y, width, height }) =>
        document
          .elementFromPoint(x + width / 2, y + height / 2)
          ?.closest('[data-testid="in-pane-chrome"]') !== null,
      bounds,
    ),
  ).toBe(true);
  await screenshot(page, testInfo, "in-pane-chrome-over-selection");
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
        const sameInsets = (clipPath: string, expected: number[]) => {
          const insets = /^inset\((.*)\)$/.exec(clipPath)?.[1]?.split(" ").map(Number.parseFloat);
          return (
            insets?.length === 4 &&
            insets.every((inset, index) => Math.abs(inset - expected[index]!) < 1)
          );
        };
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
          clipMatchesPane: sameInsets(getComputedStyle(portal).clipPath, [
            pane.top,
            window.innerWidth - pane.right,
            window.innerHeight - pane.bottom,
            pane.left,
          ]),
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
      clipMatchesPane: true,
      hiddenHandlesClipped: true,
      hiddenHandles: kind === "rect" ? 2 : 0,
    });
}
