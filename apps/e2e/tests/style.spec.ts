import { expect } from "@playwright/test";

import { expectInsideViewport, runAction, screenshot, selectOutput, test } from "./support";

test("reduced motion preserves control geometry while pressed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page.getByRole("region", { name: "Revenue by month" }).click();
  await page.getByRole("dialog", { name: /Add note for S1/ }).evaluate(async (dialog) => {
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

test("conflict and render-error notices follow live theme changes", async ({
  page,
  browserErrors,
}) => {
  await page.getByRole("combobox", { name: "Lens views" }).selectOption("Duplicate");
  const conflict = page.locator("[data-marimo-lens-view-conflict]");
  await expect(conflict).toBeVisible();
  await page.getByRole("combobox", { name: "Target mode" }).selectOption("Invalid selector");
  const error = page.getByRole("alert").filter({ hasText: "Lens dom_selector is invalid" });
  await expect(error).toBeVisible();
  await expect.poll(() => browserErrors.length).toBeGreaterThan(0);
  expect(browserErrors.every((message) => message.includes("Lens dom_selector is invalid"))).toBe(
    true,
  );
  browserErrors.length = 0;
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("body")).toHaveAttribute("data-theme", colorScheme);
    await expect(conflict).toHaveCSS("color-scheme", colorScheme);
    await expect(error).toHaveCSS("color-scheme", colorScheme);
  }
});

test.describe("touch controls", () => {
  test.use({ hasTouch: true });

  test("collapsed, clear, and reopen controls retain usable touch targets", async ({ page }) => {
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await page.getByRole("button", { name: "Collapse Lens" }).click();
    const collapsed = page.getByRole("button", { name: "Open Lens", exact: true });
    expect((await collapsed.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await collapsed.click();
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

test("current and inactive selection rows retain visible keyboard focus", async ({ page }) => {
  await selectOutput(page, "point", "S1", "First month");
  await selectOutput(page, "point", "S2", "Second month");
  await page.getByRole("button", { name: "Open selections, 2 open, 0 in history" }).click();
  const current = page.locator("[data-marimo-lens-selection-summary][aria-current=true]");
  const label = current.locator("span").first();
  const resting = await label.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.keyboard.press("ArrowUp");
  const inactive = page.locator("[data-marimo-lens-selection-summary]:not([aria-current])");
  await expect(inactive).toBeFocused();
  const focused = await inactive
    .locator("span")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.keyboard.press("ArrowDown");
  await expect(current).toBeFocused();
  await expect(label).toHaveCSS("background-color", focused);
  expect(focused).not.toBe(resting);
});

test("dark collapsed controls retain their palette without native host tokens", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await page.locator("[data-marimo-lens-portal]").evaluate((host) => {
    for (const name of [
      "--background",
      "--slate-1",
      "--slate-3",
      "--slate-6",
      "--slate-7",
      "--slate-11",
      "--slate-12",
      "--grass-2",
      "--grass-7",
      "--grass-11",
    ]) {
      host.style.setProperty(name, "initial");
    }
  });
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const tab = page.getByRole("button", { name: "Open Lens", exact: true });
  for (const hovered of [false, true]) {
    if (hovered) await tab.hover();
    const channels = await tab.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations({ subtree: true }).map((animation) => animation.finished),
      );
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(element, "::before").backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    });
    expect(channels[3]).toBe(255);
    expect(Math.max(...channels.slice(0, 3))).toBeLessThan(128);
  }
  await screenshot(page, testInfo, "dark-host-collapsed");
});

test("selection borders and the collapsed dock follow forced colors", async ({ page }) => {
  await selectOutput(page, "point", "S1", "First month");
  await selectOutput(page, "region", "S2", "Quarter");
  await page.emulateMedia({ forcedColors: "active" });
  const highlight = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "Highlight";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  for (const kind of ["point", "rect"]) {
    await expect(
      page.locator(`button[data-marimo-lens-selection-id][data-kind="${kind}"]`),
    ).toHaveCSS("border-top-color", highlight);
  }
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const tab = page.getByRole("button", { name: /^Open Lens/ });
  await expect
    .poll(() => tab.evaluate((element) => getComputedStyle(element, "::before").borderTopColor))
    .toBe(highlight);
});

test("long attention notices scroll inside and outside the selection sheet", async ({
  page,
}, testInfo) => {
  await selectOutput(page, "point", "S1", "Inspect progress");
  await runAction(page, "Start multiline activity");
  await page.getByRole("checkbox", { name: "Show revenue" }).uncheck();
  await page.setViewportSize({ width: 390, height: 400 });
  const notice = page.locator("[data-marimo-lens-target-attention-notice]");
  await expect(notice).toBeVisible();
  for (const open of [false, true]) {
    if (open)
      await page.getByRole("button", { name: "Open selections, 1 open, 0 in history" }).click();
    const scroll = page.locator(
      open ? "[data-marimo-lens-sheet-notice]" : "[data-marimo-lens-dock-panel]",
    );
    await expectInsideViewport(page, scroll);
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await scroll.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await screenshot(page, testInfo, open ? "long-sheet-notice" : "long-dock-notice");
  }
});

test("busy point and region markers dim consistently during note saves", async ({ page }) => {
  await selectOutput(page, "point", "S1", "Check this month");
  await selectOutput(page, "region", "S2", "Check the quarter");
  const opacities: number[] = [];
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
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
      opacities.push(opacity);
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
    await expect(editor).toBeHidden();
  }
  expect(opacities[1]).toBeCloseTo(opacities[0]!);
});
