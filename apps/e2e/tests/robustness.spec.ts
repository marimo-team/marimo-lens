import { expect, type Page } from "@playwright/test";

import { runAction, selectOutput, test } from "./support";

declare global {
  interface Window {
    encodingGate: { started: number; release: () => void };
  }
}

async function interceptEncoding(page: Page, mode: "fail" | "hold") {
  await page.evaluate((mode) => {
    const native = HTMLCanvasElement.prototype.toBlob;
    const pending: (() => void)[] = [];
    window.encodingGate = {
      started: 0,
      release: () => {
        HTMLCanvasElement.prototype.toBlob = native;
        for (const encode of pending.splice(0)) encode();
      },
    };
    // Hold the real browser encoder to make the capture/mutation ordering deterministic.
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      window.encodingGate.started += 1;
      if (mode === "fail") callback(null);
      else pending.push(() => native.call(this, callback, type, quality));
    };
  }, mode);
}

async function openSelections(page: Page) {
  await page.getByRole("button", { name: /^Open selections,/ }).click();
  await expect(page.getByRole("region", { name: "Selections", exact: true })).toBeVisible();
}

async function reopen(page: Page, label: string) {
  await openSelections(page);
  await page.getByRole("tab", { name: /History/ }).click();
  await page
    .getByRole("button", { name: `Reopen ${label}`, exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Close selections" }).click();
}

test("stale and partially invalid agent resolutions preserve the current annotations atomically", async ({
  page,
}) => {
  await selectOutput(page, "point", "S1", "Original request");
  await runAction(page, "Remember revision");
  await openSelections(page);
  await page.getByRole("button", { name: "Edit note for S1", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note for selection S1" })
    .fill("User changed the request");
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click();
  const current = await runAction(page);
  const stale = await runAction(page, "Resolve remembered");
  expect(stale.error).toEqual({ code: "revision_conflict", revision: current.references.revision });
  expect(stale.references).toMatchObject({
    revision: current.references.revision,
    selections: current.references.selections,
  });
  expect(stale.images).toEqual(current.images);
  const invalid = await runAction(page, "Resolve unknown");
  expect(invalid.error?.code).toBe("selection_not_found");
  expect(invalid.references).toMatchObject({
    revision: current.references.revision,
    selections: current.references.selections,
  });
  expect(invalid.images).toEqual(current.images);
  expect((await runAction(page, "Resolve")).references.selections).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Open selections, 0 open, 1 in history" }),
  ).toBeVisible();
});

test("an encoder failure preserves text context and reopening captures fresh evidence", async ({
  page,
}) => {
  await interceptEncoding(page, "fail");
  await selectOutput(page, "region", "S1", "Keep this request even if the image fails");
  await expect.poll(() => page.evaluate(() => window.encodingGate.started)).toBeGreaterThan(0);
  await expect
    .poll(async () => (await runAction(page)).references.selections[0].snapshot.status)
    .toBe("failed");
  const failed = await runAction(page);
  expect(failed.images).toEqual({});
  expect(failed.text).toContain("Keep this request even if the image fails");
  await page.evaluate(() => window.encodingGate.release());
  await runAction(page, "Resolve");
  await reopen(page, "S1");
  await expect
    .poll(async () => (await runAction(page)).references.selections[0].snapshot.status)
    .toBe("available");
  const recovered = await runAction(page);
  expect(recovered.references.selections[0]).toMatchObject({
    id: failed.references.selections[0].id,
    note: failed.references.selections[0].note,
    anchor: failed.references.selections[0].anchor,
  });
  expect(recovered.images[failed.references.selections[0].id].signature).toBe("89504e470d0a1a0a");
});

test("deleting a selection while PNG encoding is pending cannot resurrect it or its image", async ({
  page,
}) => {
  await interceptEncoding(page, "hold");
  await selectOutput(page, "point", "S1", "Delete before encoding completes");
  await expect.poll(() => page.evaluate(() => window.encodingGate.started)).toBeGreaterThan(0);
  const pending = await runAction(page);
  expect(pending.references.selections[0].snapshot.status).toBe("pending");
  await openSelections(page);
  await page.getByRole("button", { name: "Remove selection S1", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selections", exact: true })).toBeHidden();
  await page.evaluate(() => window.encodingGate.release());
  await selectOutput(page, "region", "S2", "The next request still works");
  const result = await runAction(page);
  expect(result.references.selections.map(({ label }) => label)).toEqual(["S2"]);
  expect(Object.keys(result.images)).toEqual([result.references.selections[0].id]);
  expect(result.images[pending.references.selections[0].id]).toBeUndefined();
});

test("output replacement during capture rejects the old pixels and supports a new annotation", async ({
  page,
}) => {
  await interceptEncoding(page, "hold");
  await selectOutput(page, "point", "S1", "Output is about to rerun");
  await expect.poll(() => page.evaluate(() => window.encodingGate.started)).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Show revenue" }).uncheck();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeHidden();
  await page.getByRole("checkbox", { name: "Show revenue" }).check();
  await expect(page.getByRole("region", { name: "Revenue by month" })).toBeVisible();
  await page.evaluate(() => window.encodingGate.release());
  await expect
    .poll(async () => (await runAction(page)).references.selections[0].snapshot.status)
    .toBe("failed");
  await selectOutput(page, "point", "S2", "Observe the replacement output");
  const result = await runAction(page);
  expect(result.references.selections.map(({ snapshot }) => snapshot.status)).toEqual([
    "failed",
    "available",
  ]);
  expect(Object.keys(result.images)).toEqual([result.references.selections[1].id]);
  expect(result.references.selections[0].target.cellIds).toEqual(
    result.references.selections[1].target.cellIds,
  );
});

test("cancelling a region drag leaves no annotation and releases notebook controls", async ({
  page,
}) => {
  const target = page.getByRole("region", { name: "Revenue by month" });
  await target.scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Revenue output is unavailable");
  await page.mouse.move(bounds.x + 30, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, bounds.y + 100, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await runAction(page)).references.selections).toEqual([]);
  await page.getByRole("checkbox", { name: "Show revenue" }).uncheck();
  await expect(target).toBeHidden();
  await page.getByRole("checkbox", { name: "Show revenue" }).check();
  await selectOutput(page, "region", "S1", "Region after cancellation");
  expect((await runAction(page)).references.selections[0].anchor.kind).toBe("rect");
});

test("duplicate views retain one owner and the same kernel selections", async ({ page }) => {
  await selectOutput(page, "point", "S1", "Survive view replacement");
  const before = await runAction(page);
  const owner = await runAction(page, "Connect to active Lens");
  expect(owner.mounted_identity).toBeTruthy();
  const views = page.getByRole("combobox", { name: "Lens views" });
  const ownershipWarnings: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "warning" &&
      message.text().includes("another Lens view owns this browser document")
    ) {
      ownershipWarnings.push(message.text());
    }
  });
  await views.selectOption({ label: "Duplicate" });
  await expect(page.getByText("Lens is already active", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toHaveCount(1);
  await expect.poll(() => ownershipWarnings.length).toBe(1);
  const connected = await runAction(page, "Connect to active Lens");
  expect(connected.mounted_identity).toBe(owner.mounted_identity);
  expect(connected.references.selections).toEqual(before.references.selections);
  await views.selectOption({ label: "Hidden" });
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toHaveCount(0);
  await views.selectOption({ label: "Single" });
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toHaveCount(1);
  const after = await runAction(page);
  expect(after.references).toMatchObject({
    revision: before.references.revision,
    selections: before.references.selections,
  });
  expect(after.images).toEqual(before.images);
  await selectOutput(page, "region", "S2", "Exactly one new annotation");
  expect((await runAction(page)).references.selections.map(({ label }) => label)).toEqual([
    "S1",
    "S2",
  ]);
});

test("the selection limit rejects overflow and deletion restores capacity", async ({ page }) => {
  await interceptEncoding(page, "fail");
  await selectOutput(page, "point", "S1", "First selection");
  expect((await runAction(page, "Seed 63 selections")).references.selections).toHaveLength(63);
  await expect(
    page.getByRole("button", { name: "Open selections, 63 open, 0 in history" }),
  ).toBeVisible();
  await selectOutput(page, "point", "S64", "Last available selection");
  const full = await runAction(page);
  expect(full.references.selections).toHaveLength(64);
  await page.getByRole("region", { name: "Revenue by month" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Select a target", exact: true }).click();
  await page
    .getByRole("region", { name: "Revenue by month" })
    .click({ position: { x: 40, y: 40 } });
  await expect(
    page.getByText("Lens supports up to 64 selections.", { exact: true }),
  ).toBeAttached();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await runAction(page)).references).toMatchObject({
    revision: full.references.revision,
    selections: full.references.selections,
  });
  await openSelections(page);
  await page.getByRole("button", { name: "Remove selection S1", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selections", exact: true })).toBeHidden();
  await page.evaluate(() => window.encodingGate.release());
  await selectOutput(page, "region", "S65", "Capacity is available again");
  const recovered = await runAction(page);
  expect(recovered.references.selections).toHaveLength(64);
  expect(recovered.references.selections.map(({ label }) => label)).not.toContain("S1");
  expect(recovered.references.selections.at(-1)?.snapshot.status).toBe("available");
  await openSelections(page);
  await page.getByRole("button", { name: "Clear selections", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selections", exact: true })).toBeHidden();
  expect((await runAction(page)).images).toEqual({});
});

test("unmounting during capture settles the interrupted image after remount", async ({ page }) => {
  await interceptEncoding(page, "hold");
  await selectOutput(page, "point", "S1", "Retain the request across a view rerun");
  await expect.poll(() => page.evaluate(() => window.encodingGate.started)).toBeGreaterThan(0);
  const pending = await runAction(page);
  const views = page.getByRole("combobox", { name: "Lens views" });
  await views.selectOption({ label: "Hidden" });
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.encodingGate.release());
  await views.selectOption({ label: "Single" });
  await expect(page.getByRole("button", { name: "Select a target", exact: true })).toBeVisible();
  await expect
    .poll(async () => (await runAction(page)).references.selections[0].snapshot.status)
    .toBe("failed");
  const interrupted = await runAction(page);
  expect(interrupted.references.selections[0]).toMatchObject({
    id: pending.references.selections[0].id,
    note: pending.references.selections[0].note,
  });
  expect(interrupted.images).toEqual({});
  await runAction(page, "Resolve");
  await reopen(page, "S1");
  await expect
    .poll(async () => (await runAction(page)).references.selections[0].snapshot.status)
    .toBe("available");
});

test("touch dragging and cancellation leave the next dock action usable", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  const grip = page.getByRole("button", { name: "Move Lens", exact: true });
  const start = (await grip.boundingBox())!;
  const dock = page.locator("[data-marimo-lens-dock]");
  const before = (await dock.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 40, y: y - 120, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeCloseTo(before.y - 120, 0);
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  const pill = page.getByRole("button", { name: "Open Lens", exact: true });
  const closed = (await pill.boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: closed.x + 20, y: closed.y + 20, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: closed.x + 40, y: closed.y - 80, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeCloseTo(closed.y, 0);
  await pill.click();
  await expect(grip).toBeVisible();
  await session.detach();
});

test("touch dragging creates a region selection", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  const target = page.getByRole("region", { name: "Revenue by month" });
  await target.scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "Select a target", exact: true })
    .click({ noWaitAfter: true });
  await expect(
    page.getByRole("button", { name: "Cancel selection mode", exact: true }),
  ).toBeVisible();
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Revenue output is unavailable");
  const x = bounds.x + bounds.width * 0.3;
  const y = bounds.y + bounds.height * 0.35;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + bounds.width * 0.35, y: y + bounds.height * 0.45, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  const editor = page.getByRole("dialog", { name: /Add note for S1/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Done", exact: true }).click({ noWaitAfter: true });
  await expect(editor).toBeHidden();
  expect((await runAction(page)).references.selections[0].anchor.kind).toBe("rect");
  await session.detach();
});

test("invalid or unavailable position storage preserves dock controls", async ({ page }) => {
  const grip = page.getByRole("button", { name: "Move Lens", exact: true });
  const views = page.getByRole("combobox", { name: "Lens views" });
  const remount = async () => {
    await views.selectOption("Hidden");
    await expect(grip).toHaveCount(0);
    await views.selectOption("Single");
    await expect(grip).toBeVisible();
  };
  await page.evaluate(() =>
    localStorage.setItem("marimo-lens:dock-position:v1", '{"x":null,"y":1e999}'),
  );
  await remount();
  const dock = page.locator("[data-marimo-lens-dock]");
  const initial = (await dock.boundingBox())!;
  expect(initial.y + initial.height).toBeLessThan(page.viewportSize()!.height);
  await page.evaluate(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("marimo-lens:")) throw new DOMException("Denied", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("marimo-lens:")) throw new DOMException("Denied", "SecurityError");
      return set.call(this, key, value);
    };
  });
  await remount();
  await grip.press("Shift+ArrowUp");
  await expect.poll(async () => (await dock.boundingBox())!.y).toBeCloseTo(initial.y - 40, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Collapse Lens" }).click();
  await expect(page.getByRole("button", { name: "Open Lens", exact: true })).toBeVisible();
  expect(
    await dock.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
});
