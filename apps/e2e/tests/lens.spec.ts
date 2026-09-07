import { expect, type Locator } from "@playwright/test";

import { expectInsideViewport, runAction, screenshot, selectOutput, test } from "./support";

test("point and region attention survive note edits, resolution, and image recapture", async ({
  page,
}, testInfo) => {
  await selectOutput(page, "point", "S1", "Check February");
  await selectOutput(page, "region", "S2", "Compare the quarter");
  const before = await runAction(page);
  expect(before.references.selections).toMatchObject([
    {
      label: "S1",
      note: "Check February",
      anchor: { kind: "point" },
      target: { kind: "notebook" },
      snapshot: { status: "available" },
    },
    {
      label: "S2",
      note: "Compare the quarter",
      anchor: { kind: "rect" },
      snapshot: { status: "available" },
    },
  ]);
  for (const selection of before.references.selections) {
    expect(selection.target.cellIds).toHaveLength(1);
    expect(selection.cells).toEqual([{ id: selection.target.cellIds[0], status: "available" }]);
    expect(before.images[selection.id].signature).toBe("89504e470d0a1a0a");
    expect(before.images[selection.id].bytes).toBeGreaterThan(100);
  }
  expect(before.text).toContain("Revenue by month");
  expect(before.text).toContain("Compare the quarter");
  await page.getByRole("button", { name: "Open selections, 2 open, 0 in history" }).click();
  const sheet = page.getByRole("region", { name: "Selections", exact: true });
  await expectInsideViewport(page, sheet);
  await page.getByRole("button", { name: "Edit note for S1", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /Edit note for S1/ });
  await expectInsideViewport(page, editor);
  await page
    .getByRole("textbox", { name: "Note for selection S1" })
    .fill("Explain the February increase");
  await screenshot(page, testInfo, "note-editor");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Open selections, 2 open, 0 in history" }).click();
  await page.getByRole("button", { name: "View image for S1.", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Selection image for S1", exact: true });
  await expect(preview.getByRole("img")).toBeVisible();
  await expect
    .poll(() => preview.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expectInsideViewport(page, preview);
  await screenshot(page, testInfo, "selection-image");
  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error("Viewport is unavailable");
  await page.setViewportSize({ width: originalViewport.width, height: 400 });
  await expectInsideViewport(page, preview);
  await screenshot(page, testInfo, "short-viewport-preview");
  await page.setViewportSize(originalViewport);
  await preview.getByRole("button", { name: "Close preview" }).focus();
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  const resolved = await runAction(page, "Resolve");
  expect(resolved.references.selections).toEqual([]);
  expect(resolved.images).toEqual({});
  await page.getByRole("button", { name: "Open selections, 0 open, 2 in history" }).click();
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByRole("button", { name: "Reopen S1", exact: true })).toBeVisible();
  await expectInsideViewport(page, sheet);
  await screenshot(page, testInfo, "history");
  await page.getByRole("button", { name: "Reopen S1", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open selections, 1 open, 2 in history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close selections" }).click();
  const reopened = await runAction(page);
  expect(reopened.references.selections).toMatchObject([
    {
      id: before.references.selections[0].id,
      label: "S1",
      note: "Explain the February increase",
      anchor: before.references.selections[0].anchor,
      snapshot: { status: "available" },
    },
  ]);
  expect(reopened.images[before.references.selections[0].id].signature).toBe("89504e470d0a1a0a");
  expect(reopened.references.revision).toBeGreaterThan(before.references.revision);
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  await expectInsideViewport(page, page.getByRole("button", { name: /^Open Lens/ }));
  await screenshot(page, testInfo, "collapsed");
});

test("agent activity and reveal reach the selected output through the kernel", async ({
  page,
}, testInfo) => {
  await selectOutput(page, "point", "S1", "Check this month");
  const before = await runAction(page, "Start activity");
  await expect(page.getByText("Checking monthly revenue", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "activity");
  await runAction(page, "Stop activity");
  await expect(page.getByText("Checking monthly revenue", { exact: true })).toBeHidden();
  const revealed = await runAction(page, "Reveal");
  await expect(page.getByText("Compare these months", { exact: true })).toBeVisible();
  expect(revealed.references.revision).toBe(before.references.revision);
  expect(revealed.references.selections).toEqual(before.references.selections);
  await screenshot(page, testInfo, "reveal");
});

test("keyboard selection, dialog cancellation, and dock focus remain usable", async ({ page }) => {
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  await expect(page.getByRole("button", { name: "Open Lens", exact: true })).toBeFocused();
  await page.keyboard.press("Alt+l");
  await expect(
    page.getByRole("button", { name: "Cancel selection mode", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toBeVisible();
  await selectOutput(page, "point", "S1", "Preserve this note");
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await page.getByRole("button", { name: "Edit note for S1", exact: true }).click();
  const note = page.getByRole("textbox", { name: "Note for selection S1" });
  await note.fill("Discard this draft");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /Edit note/ })).toBeHidden();
  const report = await runAction(page);
  expect(report.references.selections[0].note).toBe("Preserve this note");
});

test("configured DOM targets retain attention while their output disappears and returns", async ({
  page,
}) => {
  await page.getByRole("combobox", { name: "Target mode" }).selectOption({ label: "DOM roots" });
  await runAction(page);
  await selectOutput(page, "region", "S1", "Compare these bars");
  const captured = await runAction(page);
  expect(captured.references.selections).toMatchObject([
    {
      target: { kind: "dom" },
      anchor: { kind: "rect" },
    },
  ]);
  const selector = captured.references.selections[0].target.domSelector;
  if (!selector) throw new Error("DOM target has no selector");
  await expect(page.locator(selector)).toHaveAttribute("aria-label", "Revenue by month");
  await page.getByRole("checkbox", { name: "Show revenue" }).uncheck();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeHidden();
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await expect(
    page.getByRole("button", { name: /Current selection S1,.*target unavailable/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close selections" }).click();
  await page.getByRole("checkbox", { name: "Show revenue" }).check();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeVisible();
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await expect(
    page.getByRole("button", { name: /Current selection S1,.*target unavailable/ }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: /Current selection S1, Compare these bars/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close selections" }).click();
  const restored = await runAction(page);
  expect(restored.references.selections).toEqual(captured.references.selections);
  expect(restored.images).toEqual(captured.images);
});

async function contrastRatio(label: Locator): Promise<number> {
  return label.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    const ancestors: Element[] = [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      ancestors.unshift(ancestor);
    }
    context.fillStyle = "white";
    context.fillRect(0, 0, 1, 1);
    for (const ancestor of ancestors) {
      context.fillStyle = getComputedStyle(ancestor).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = context.getImageData(0, 0, 1, 1).data;
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    const foreground = context.getImageData(0, 0, 1, 1).data;
    const luminance = (color: Uint8ClampedArray) => {
      const linear = Array.from(color)
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const first = luminance(background);
    const second = luminance(foreground);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  });
}

test("live theme changes preserve attention and readable selection labels", async ({
  page,
  colorScheme,
}, testInfo) => {
  await selectOutput(page, "point", "S1", "Keep this selection");
  const before = await runAction(page);
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  const label = page
    .getByRole("button", { name: /Current selection S1, Keep this selection/ })
    .getByText("S1", { exact: true });
  await expect.poll(() => contrastRatio(label)).toBeGreaterThanOrEqual(4.5);
  const nextScheme = colorScheme === "dark" ? "light" : "dark";
  await page.emulateMedia({ colorScheme: nextScheme });
  await expect(page.locator("body")).toHaveAttribute("data-theme", nextScheme);
  await expect.poll(() => contrastRatio(label)).toBeGreaterThanOrEqual(4.5);
  await screenshot(page, testInfo, "theme-switch");
  await page.getByRole("button", { name: "Close selections" }).click();
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const badge = page.getByRole("button", { name: /^Open Lens/ }).getByText("1", { exact: true });
  await expect.poll(() => contrastRatio(badge)).toBeGreaterThanOrEqual(4.5);
  await page.getByRole("button", { name: /^Open Lens/ }).click();
  const after = await runAction(page);
  expect(after.references.selections).toEqual(before.references.selections);
  expect(after.references.revision).toBe(before.references.revision);
});
