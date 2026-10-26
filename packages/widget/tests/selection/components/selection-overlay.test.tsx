import type { Selection, SelectionAnchor, TargetSelector } from "@marimo-lens/protocol";

import { act } from "react";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vite-plus/test";

import { targetFromElement } from "@/notebook/selection-target";
import { SelectionOverlay } from "@/selection/components/selection-overlay";

import { selectionFixture } from "../../support/fixtures";
import { NotebookDomTestProvider } from "../../support/notebook-dom";
import { render } from "../../support/render";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selection overlay", () => {
  test("keeps a hovered DOM target highlighted while producer metadata updates", () => {
    const target = document.createElement("section");
    target.id = "summary";
    target.dataset.feedbackTarget = "";
    target.dataset.marimoLensCellId = "cell-1";
    target.getBoundingClientRect = () => new DOMRect(20, 30, 400, 240);
    document.body.appendChild(target);
    const selector = "[data-feedback-target]";
    const activeTarget = targetFromElement(target, selector);
    expect(activeTarget).not.toBeNull();

    target.dataset.marimoLensCellId = "cell-2";
    renderOverlay([], null, { workflow: { mode: "armed", activeTarget: activeTarget! } }, selector);

    const highlight = document.querySelector<HTMLElement>("[data-marimo-lens-output-highlight]");
    expect(highlight).not.toBeNull();
  });

  test("renders markers only inside the visible output viewport", () => {
    setupOutput({ scrollHeight: 800, scrollTop: 400 });
    const hidden = selectionFixture({ anchor: { kind: "point", x: 0.5, y: 0.1 } });
    const visible = selectionFixture({
      id: "selection-2",
      label: "S2",
      anchor: { kind: "point", x: 0.5, y: 0.6 },
    });
    renderOverlay([hidden, visible], visible.id);

    expect(document.querySelector('[data-marimo-lens-selection-id="selection-1"]')).toBeNull();
    expect(document.querySelector('[data-marimo-lens-selection-id="selection-2"]')).not.toBeNull();
  });

  test("attaches a marker to nested scroll content rendered after mount", async () => {
    const output = setupOutput();
    const stream = document.createElement("div");
    document.body.append(stream);
    const hitTest = vi.spyOn(document, "elementsFromPoint");
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.3 },
    });
    renderOverlay([selection], selection.id);

    const reads = hitTest.mock.calls.length;
    await act(async () => {
      stream.textContent = "Unrelated output update";
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });
    expect(hitTest).toHaveBeenCalledTimes(reads);

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "100px",
    );
    const { scroller } = setupNestedScroller(output);
    scroller.scrollLeft = 120;
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "100px",
    );
    scroller.scrollLeft = 160;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "60px",
    );
    scroller.scrollLeft = 180;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "40px",
    );
  });

  test("moves a marker on the first scroll after its ancestor becomes scrollable", async () => {
    const { scroller } = setupNestedScroller();
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 400 });
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.3 },
    });
    renderOverlay([selection], selection.id);
    const left = () =>
      document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left;
    expect(left()).toBe("100px");

    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 800 });
    scroller.scrollLeft = 40;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      vi.advanceTimersToNextFrame();
    });

    expect(left()).toBe("60px");
  });

  test("discovers newly hittable nested content on scroll", async () => {
    const output = setupOutput();
    const { scroller } = setupNestedScroller(output);
    const hitTest = document.elementsFromPoint.bind(document);
    let hittable = false;
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) => (hittable ? hitTest(x, y) : [output]),
    });
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.3 },
    });
    renderOverlay([selection], selection.id);
    for (const [scroll, left] of [
      [40, "100px"],
      [60, "80px"],
    ] as const) {
      await act(async () => {
        hittable = true;
        scroller.scrollLeft = scroll;
        scroller.dispatchEvent(new Event("scroll"));
        await Promise.resolve();
        vi.advanceTimersToNextFrame();
      });
      expect(
        document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left,
      ).toBe(left);
    }
  });

  test("marks the current selection and exposes resize handles for its region", () => {
    setupOutput();
    const current = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    });
    const other = selectionFixture({
      id: "selection-2",
      label: "S2",
      anchor: { kind: "rect", x: 0.6, y: 0.2, width: 0.2, height: 0.3 },
    });
    renderOverlay([current, other], current.id);

    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    );
    expect(marker?.getAttribute("aria-current")).toBe("true");
    const handles = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-marimo-lens-resize-handle]"),
    );
    expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual([
      "Resize selection S1 from top left. Use arrow keys.",
      "Resize selection S1 from top right. Use arrow keys.",
      "Resize selection S1 from bottom left. Use arrow keys.",
      "Resize selection S1 from bottom right. Use arrow keys.",
    ]);
  });

  test("makes existing markers inert while selecting another output", () => {
    const output = setupOutput();
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    });
    const rerender = renderOverlay([selection], selection.id);

    rerender({
      workflow: { mode: "armed", activeTarget: targetFromElement(output, null) },
    });

    expect(
      document.querySelector<HTMLButtonElement>(`[data-marimo-lens-selection-id="${selection.id}"]`)
        ?.disabled,
    ).toBe(true);
    expect(document.querySelector("[data-marimo-lens-resize-handle]")).toBeNull();
  });

  test("opens note editing when a marker is activated", () => {
    setupOutput();
    const selection = selectionFixture();
    const onEditNote = vi.fn();
    renderOverlay([selection], null, { onEditNote });

    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    );
    act(() => marker?.focus());
    expect(onEditNote).not.toHaveBeenCalled();

    act(() => marker?.click());
    expect(onEditNote).toHaveBeenCalledWith(selection, "instant");
  });

  test("commits keyboard resizing once", () => {
    setupOutput();
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    });
    const onReposition = vi.fn<(selection: Selection, anchor: SelectionAnchor) => void>();
    renderOverlay([selection], selection.id, { onReposition });

    const southeast = document.querySelector<HTMLButtonElement>('[data-handle="se"]');
    act(() => {
      southeast?.focus();
      southeast?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      southeast?.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    });

    expect(onReposition).toHaveBeenCalledTimes(1);
    expect(onReposition.mock.calls[0]?.[1]).toMatchObject({
      kind: "rect",
      x: 0.2,
      y: 0.2,
      width: 0.31,
      height: 0.3,
    });
  });

  test("cancels a pointer resize when its handles unmount", () => {
    stubPointerCapture();
    setupOutput();
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    });
    const registerAdjustment = vi.fn();
    const releaseAdjustment = vi.fn();
    const rerender = renderOverlay([selection], selection.id, {
      registerAdjustment,
      releaseAdjustment,
    });
    const rectMarker = () => document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]");

    const southeast = document.querySelector<HTMLButtonElement>('[data-handle="se"]')!;
    act(() => {
      southeast.dispatchEvent(pointer("pointerdown", 200, 150, 7));
      southeast.dispatchEvent(pointer("pointermove", 240, 150, 7));
    });
    expect(rectMarker()?.style.width).toBe("160px");

    rerender({ currentSelectionId: null });

    expect(document.querySelector("[data-marimo-lens-resize-handle]")).toBeNull();
    expect(rectMarker()?.style.width).toBe("120px");
    expect(releaseAdjustment).toHaveBeenCalledWith(registerAdjustment.mock.calls[0]?.[0]);
  });

  test("opens no note when a marker move canceled with Escape is released", () => {
    stubPointerCapture();
    setupOutput();
    const selection = selectionFixture({ anchor: { kind: "point", x: 0.5, y: 0.5 } });
    const registerAdjustment = vi.fn<(cancel: () => void) => void>();
    const onEditNote = vi.fn();
    const onReposition = vi.fn();
    renderOverlay([selection], selection.id, { registerAdjustment, onEditNote, onReposition });
    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    )!;
    act(() => {
      marker.dispatchEvent(pointer("pointerdown", 220, 140, 7));
      marker.dispatchEvent(pointer("pointermove", 228, 140, 7));
    });

    // Escape cancels the adjustment that the press registered.
    act(() => registerAdjustment.mock.calls[0]![0]());
    act(() => {
      marker.dispatchEvent(pointer("pointerup", 228, 140, 7));
      marker.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });

    expect(onReposition).not.toHaveBeenCalled();
    expect(onEditNote).not.toHaveBeenCalled();
  });

  test("cancels a marker drag when the dragged marker leaves the visible output", () => {
    stubPointerCapture();
    setupOutput({ scrollHeight: 800 });
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.1, width: 0.3, height: 0.1 },
    });
    const registerAdjustment = vi.fn();
    const releaseAdjustment = vi.fn();
    renderOverlay([selection], selection.id, { registerAdjustment, releaseAdjustment });
    const marker = () =>
      document.querySelector<HTMLButtonElement>('[data-marimo-lens-selection-id="selection-1"]');

    const dragged = marker()!;
    act(() => {
      dragged.dispatchEvent(pointer("pointerdown", 150, 120, 7));
      dragged.dispatchEvent(pointer("pointermove", 150, 320, 7));
    });

    expect(releaseAdjustment).toHaveBeenCalledWith(registerAdjustment.mock.calls[0]?.[0]);
    expect(marker()).not.toBeNull();
    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.top).toBe(
      "100px",
    );
  });
});

// jsdom leaves pointer capture unimplemented.
function stubPointerCapture() {
  const captured = new Set<number>();
  const methods = {
    setPointerCapture: (id: number) => void captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => void captured.delete(id),
  };
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
  }
  onTestFinished(() => {
    for (const name of Object.keys(methods)) Reflect.deleteProperty(HTMLElement.prototype, name);
  });
}

function pointer(type: string, clientX: number, clientY: number, pointerId: number) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
    pointerId,
  });
}

function setupOutput({ scrollHeight = 240, scrollTop = 0 } = {}) {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
  Object.defineProperties(output, {
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, value: scrollTop },
  });
  document.body.appendChild(output);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [output],
  });
  return output;
}

function setupNestedScroller(output = setupOutput()) {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const scroller = document.createElement("div");
  const content = document.createElement("div");
  scroller.style.overflow = "auto";
  scroller.appendChild(content);
  shadow.appendChild(scroller);
  output.appendChild(host);
  Object.defineProperties(scroller, {
    offsetWidth: { configurable: true, value: 400 },
    offsetHeight: { configurable: true, value: 240 },
    clientWidth: { configurable: true, value: 400 },
    clientHeight: { configurable: true, value: 240 },
    scrollWidth: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 240 },
    scrollLeft: { configurable: true, value: 0, writable: true },
    scrollTop: { configurable: true, value: 0, writable: true },
  });
  scroller.getBoundingClientRect = () => new DOMRect(20, 20, 400, 240);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [host, output],
  });
  Object.defineProperty(shadow, "elementsFromPoint", {
    configurable: true,
    value: () => [content],
  });
  return { scroller };
}

function renderOverlay(
  selections: Selection[],
  currentSelectionId: string | null,
  overrides: Partial<React.ComponentProps<typeof SelectionOverlay>> = {},
  selector: TargetSelector = null,
) {
  const overlay = (next: Partial<React.ComponentProps<typeof SelectionOverlay>> = {}) => (
    <NotebookDomTestProvider selector={selector}>
      <SelectionOverlay
        selections={selections}
        currentSelectionId={currentSelectionId}
        workflow={{ mode: "idle" }}
        busySelectionIds={new Set()}
        onActivate={() => {}}
        onEditNote={() => {}}
        onReposition={() => {}}
        registerAdjustment={() => {}}
        releaseAdjustment={() => {}}
        {...overrides}
        {...next}
      />
    </NotebookDomTestProvider>
  );
  const { rerender } = render(overlay());
  return (next: Partial<React.ComponentProps<typeof SelectionOverlay>> = {}) =>
    rerender(overlay(next));
}
