import type { Selection, SelectionAnchor } from "@marimo-lens/protocol";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { targetFromElement } from "@/notebook/selection-target";
import { SelectionOverlay } from "@/selection/components/selection-overlay";

import { selectionFixture } from "../../support/fixtures";
import { NotebookDomTestProvider } from "../../support/notebook-dom";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    renderOverlay([], null, {
      selector,
      workflow: { mode: "armed", activeTarget: activeTarget! },
    });

    const highlight = document.querySelector<HTMLElement>("[data-marimo-lens-output-highlight]");
    expect(highlight?.style.left).toBe("20px");
    expect(highlight?.style.width).toBe("400px");
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

  test("moves a region with the nested content it covers", () => {
    const { scroller } = setupNestedScroller();
    scroller.scrollLeft = 120;
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.3 },
    });
    const rerender = renderOverlay([selection], selection.id);

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "100px",
    );

    scroller.scrollLeft = 160;
    rerender();

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "60px",
    );
  });

  test("attaches a marker to nested scroll content rendered after mount", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
    const output = setupOutput();
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.3 },
    });
    renderOverlay([selection], selection.id);

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "100px",
    );
    const { scroller } = setupNestedScroller(output);
    scroller.scrollLeft = 120;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "100px",
    );
    scroller.scrollLeft = 160;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "60px",
    );
    scroller.scrollLeft = 180;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "40px",
    );
  });

  test("moves a marker on the first scroll after its ancestor becomes scrollable", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
    const { scroller } = setupNestedScroller();
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 400 });
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.2, height: 0.3 },
    });
    renderOverlay([selection], selection.id);

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "100px",
    );
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 800 });
    scroller.scrollLeft = 40;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });

    expect(document.querySelector<HTMLElement>("[data-marimo-lens-rect-marker]")?.style.left).toBe(
      "60px",
    );
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
});

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
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const render = (next: Partial<React.ComponentProps<typeof SelectionOverlay>> = {}) => {
    act(() => {
      root?.render(
        <NotebookDomTestProvider>
          <SelectionOverlay
            selections={selections}
            currentSelectionId={currentSelectionId}
            availableSelectionIds={new Set(selections.map(({ id }) => id))}
            selector={null}
            workflow={{ mode: "idle" }}
            busySelectionIds={new Set()}
            capturingSelectionIds={new Set()}
            onActivate={() => {}}
            onEditNote={() => {}}
            onReposition={() => {}}
            registerAdjustment={() => {}}
            releaseAdjustment={() => {}}
            {...overrides}
            {...next}
          />
        </NotebookDomTestProvider>,
      );
    });
  };
  render();
  return render;
}
