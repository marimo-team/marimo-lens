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

test("custom regions retain symbolic sources through kernel context and reject retargeting", async ({
  page,
}) => {
  await page.getByRole("combobox", { name: "Target mode" }).selectOption({ label: "DOM roots" });
  await runAction(page);
  const cellId = await page.getByRole("checkbox", { name: "Show revenue" }).evaluate((control) => {
    let current: Element | null = control;
    let id: string | undefined;
    while (current) {
      if (current.id.startsWith("output-")) id = current.id.slice("output-".length);
      if (current.matches("marimo-island[data-cell-id]"))
        id = current.getAttribute("data-cell-id") ?? undefined;
      if (id) break;
      const root = current.getRootNode();
      current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    if (!id) throw new Error("The control has no producing output");
    const host = document.createElement("span");
    host.id = "visibility-input";
    host.hidden = true;
    host.dataset.marimoLensCellId = id;
    host.dataset.marimoLensSelector = "show_revenue.value";
    host.dataset.marimoLensLabel = "show_revenue.value";
    document.body.append(host);
    const region = document.getElementById("revenue-chart")!;
    region.setAttribute("data-marimo-lens-inputs", host.id);
    region.setAttribute("data-marimo-lens-label", "Revenue visibility");
    region.setAttribute(
      "data-marimo-lens-render-source",
      JSON.stringify({ path: "src/report.ts", symbol: "revenueCard", line: 12 }),
    );
    return id;
  });
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page.getByRole("region", { name: "Revenue by month" }).hover();
  const label = page.locator("[data-marimo-lens-target-label]");
  await expect(label).toHaveText("Revenue visibilityshow_revenue.value");
  await page.locator("#visibility-input").evaluate((host) => {
    host.setAttribute("data-marimo-lens-label", "Visibility control");
  });
  await expect(label).toHaveText("Revenue visibilityVisibility control");
  await page.keyboard.press("Escape");
  await selectOutput(page, "point", "S1", "Inspect the custom region input");
  const captured = await runAction(page);
  expect(captured.references.selections).toMatchObject([
    {
      target: {
        kind: "dom",
        cellIds: [cellId],
        sources: [{ cellId, selector: "show_revenue.value" }],
      },
      cells: [{ id: cellId, status: "available" }],
      snapshot: { status: "available" },
      description: {
        label: "Revenue visibility",
        detail: "Visibility control",
        renderSource: { path: "src/report.ts", symbol: "revenueCard", line: 12 },
      },
    },
  ]);
  expect(captured.text).toContain("show_revenue.value");
  expect(captured.text).toContain("mo.ui.checkbox");
  expect(captured.text).toContain("src/report.ts");
  await page
    .locator("#revenue-chart")
    .evaluate((element) => element.setAttribute("data-marimo-lens-label", "Updated label"));
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await expect(page.getByRole("button", { name: /Current selection S1,/ })).toBeVisible();
  await expect(page.locator(".ml-selection-list__details small")).toContainText(
    "Revenue visibility",
  );
  await expect(page.locator(".ml-selection-list__details small")).toHaveAttribute(
    "title",
    new RegExp(`show_revenue.value.*Cell ${cellId}`),
  );
  await page
    .locator("#visibility-input")
    .evaluate((element) => element.replaceWith(element.cloneNode(true)));
  await expect(
    page.getByRole("button", { name: /Current selection S1,.*target unavailable/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close selections" }).click();
  await runAction(page, "Resolve");
  await page.getByRole("button", { name: "Open selections, 0 open, 1 in history" }).click();
  await expect(page.locator(".ml-history-list__target")).toContainText("Revenue visibility");
  await page.getByRole("button", { name: "Reopen S1", exact: true }).click();
  await expect(page.locator(".ml-selection-list__details small")).toContainText(
    "Revenue visibility",
  );
  // A changed input signature invalidates the target even when its element stays mounted.
  await page.locator("#visibility-input").evaluate((host) => {
    host.setAttribute("data-marimo-lens-selector", "target_mode.value");
  });
  await expect(
    page.getByRole("button", { name: /Current selection S1,.*target unavailable/ }),
  ).toBeVisible();
});

test("target picking shows consumer labels at the element edge without intercepting selection", async ({
  page,
}, testInfo) => {
  await page.getByRole("combobox", { name: "Target mode" }).selectOption({ label: "DOM roots" });
  await runAction(page);
  const region = page.getByRole("region", { name: "Revenue by month" });
  await region.evaluate((element) => {
    element.setAttribute("data-marimo-lens-label", "Monthly revenue");
    element.setAttribute("data-marimo-lens-detail", "Query · finance.monthly");
  });
  const label = page.locator("[data-marimo-lens-target-label]");
  await region.hover();
  await expect(label).toBeHidden();
  await region.evaluate((element) => {
    element.style.pointerEvents = "none";
  });
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await region.hover();
  await expect(label).toContainText("Monthly revenue");
  await expect(label).toContainText("Query · finance.monthly");
  const leaf = region.locator("strong").first();
  await leaf.evaluate((element) => {
    element.style.cursor = "text";
  });
  await leaf.hover();
  await expect(leaf).toHaveCSS("cursor", "crosshair");
  await leaf.evaluate((element) => {
    element.style.cursor = "wait";
  });
  await expect(leaf).toHaveCSS("cursor", "crosshair");
  await page.keyboard.press("Escape");
  await expect(leaf).toHaveCSS("cursor", "wait");
  await expect(region).toHaveCSS("pointer-events", "none");
  await expect(label).toBeHidden();
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  const nativeControl = page.getByRole("checkbox", { name: "Show revenue" });
  await nativeControl.hover();
  await expect(nativeControl).toHaveCSS("cursor", "crosshair");
  await page.getByRole("button", { name: "Cancel selection mode", exact: true }).hover();
  await expect(nativeControl).not.toHaveCSS("cursor", "crosshair");
  await region.hover();
  await expect.poll(() => contrastRatio(label)).toBeGreaterThanOrEqual(4.5);

  await expectInsideViewport(page, label);
  const targetBounds = await region.boundingBox();
  const labelBounds = await label.boundingBox();
  expect(targetBounds).not.toBeNull();
  expect(labelBounds).not.toBeNull();
  expect(labelBounds!.y + labelBounds!.height).toBeLessThanOrEqual(targetBounds!.y);
  await screenshot(page, testInfo, "target-label");

  // A stationary pointer sees refreshed consumer text, rendered as text rather than HTML.
  await region.evaluate((element) =>
    element.setAttribute("data-marimo-lens-label", "Revenue <img src=x>"),
  );
  await expect(label).toContainText("Revenue <img src=x>");
  await expect(label.locator("img")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(label).toBeHidden();

  const select = page.getByRole("button", { name: "Select a target", exact: true });
  await select.click();
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("ArrowDown");
    if ((await label.textContent())?.includes("finance.monthly")) break;
  }
  await expect(label).toContainText("finance.monthly");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Add note for/ })).toBeVisible();
  await expect(label).toBeHidden();
  await page
    .getByRole("dialog", { name: /Add note for/ })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  // At the viewport edge the label sits inside the target. Clicking it still selects the content.
  await region.evaluate((element) => {
    element.ownerDocument.body.append(element);
    element.style.cssText += ";position:fixed;top:0;left:8px;width:calc(100vw - 32px);z-index:10";
  });
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await region.hover();
  await expect(label).toBeVisible();
  await expectInsideViewport(page, label);
  await region.evaluate((element) => {
    element.style.display = "none";
  });
  await expect(label).toBeHidden();
  await page.locator("#revenue-chart").evaluate((element) => {
    element.style.display = "grid";
  });
  await region.hover();
  await expect(label).toBeVisible();
  const overlap = await label.boundingBox();
  await page.mouse.click(overlap!.x + overlap!.width / 2, overlap!.y + overlap!.height / 2);
  await expect(page.getByRole("dialog", { name: /Add note for/ })).toBeVisible();
  await expect(label).toBeHidden();
});

test("Lens controls retain their appearance and keyboard behavior under page styles", async ({
  page,
}, testInfo) => {
  const select = page.getByRole("button", { name: "Select a target", exact: true });
  const styleOf = () =>
    select.evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        font: style.font,
        color: style.color,
        background: style.backgroundColor,
        padding: style.padding,
        height: style.height,
      };
    });
  const baseline = await styleOf();
  await page.addStyleTag({
    content: `
    :root { --muted: magenta; --foreground: lime; --background: red; }
    body { font: italic 48px serif; letter-spacing: 12px; text-transform: uppercase; }
    button, textarea { background: magenta !important; color: lime !important; font: italic 40px serif !important; padding: 40px !important; }
    header, footer { background: black !important; padding: 60px !important; }
    dialog { width: 90vw !important; border: 20px solid red !important; }
  `,
  });
  expect(await styleOf()).toEqual(baseline);
  await selectOutput(page, "point", "S1", "Scoped controls");
  await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
  await page.getByRole("button", { name: "Edit note for S1" }).click();
  const editor = page.getByRole("dialog", { name: /Edit note for S1/ });
  await expectInsideViewport(page, editor);
  const note = page.getByRole("textbox", { name: "Note for selection S1" });
  await expect(note).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(editor.getByRole("button", { name: "Done", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
  expect(await note.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    "rgb(255, 0, 255)",
  );
  expect(
    await editor.locator("footer").evaluate((element) => getComputedStyle(element).padding),
  ).toBe("0px");
  await screenshot(page, testInfo, "isolated-lens-controls");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});
