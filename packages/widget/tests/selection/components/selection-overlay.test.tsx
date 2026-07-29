import type { Selection, SelectionAnchor } from "@marimo-lens/protocol";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { SelectionOverlay } from "@/selection/components/selection-overlay";

import { selectionFixture } from "../../support/fixtures";
import { NotebookDomTestProvider } from "../../support/notebook-dom";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("selection overlay", () => {
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

    expect(document.querySelector<HTMLElement>(".ml-rect-marker")?.style.left).toBe("100px");

    scroller.scrollLeft = 160;
    rerender();

    expect(document.querySelector<HTMLElement>(".ml-rect-marker")?.style.left).toBe("60px");
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
    const handles = Array.from(document.querySelectorAll<HTMLButtonElement>(".ml-resize-handle"));
    expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual([
      "Resize selection S1 from top left. Use arrow keys.",
      "Resize selection S1 from top right. Use arrow keys.",
      "Resize selection S1 from bottom left. Use arrow keys.",
      "Resize selection S1 from bottom right. Use arrow keys.",
    ]);
  });

  test("makes existing markers inert while selecting another output", () => {
    setupOutput();
    const selection = selectionFixture({
      anchor: { kind: "rect", x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    });
    const rerender = renderOverlay([selection], selection.id);

    rerender({
      workflow: { mode: "armed", activeOutputCellId: selection.outputCellId },
    });

    expect(
      document.querySelector<HTMLButtonElement>(`[data-marimo-lens-selection-id="${selection.id}"]`)
        ?.disabled,
    ).toBe(true);
    expect(document.querySelector(".ml-resize-handle")).toBeNull();
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

function setupNestedScroller(): { scroller: HTMLElement } {
  const output = setupOutput();
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
            availableOutputCellIds={new Set(selections.map(({ outputCellId }) => outputCellId))}
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
