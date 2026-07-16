import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { Selection, SelectionAnchor } from "@/contracts";

import { SelectionOverlay } from "@/components/selection-overlay";
import { selectionFixture } from "@/test-fixtures";

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

  test("activates a marker without opening note editing", () => {
    setupOutput();
    const selection = selectionFixture();
    const onActivate = vi.fn();
    renderOverlay([selection], null, { onActivate });

    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    );
    act(() => marker?.click());
    expect(onActivate).toHaveBeenCalledWith(selection);
  });

  test("opens marker actions on focus without changing the current selection", () => {
    setupOutput();
    const selection = selectionFixture();
    const onActivate = vi.fn();
    renderOverlay([selection], null, { onActivate });

    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    );
    act(() => marker?.focus());
    expect(onActivate).not.toHaveBeenCalled();
    expect(
      document.querySelector(`[data-marimo-lens-selection-peek="${selection.id}"]`),
    ).not.toBeNull();

    act(() => marker?.click());
    expect(onActivate).toHaveBeenCalledWith(selection);
  });

  test("opens note editing next to a focused marker", () => {
    setupOutput();
    const selection = selectionFixture({ note: "" });
    const onEditNote = vi.fn();
    renderOverlay([selection], selection.id, { onEditNote });

    const marker = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-id="selection-1"]',
    );
    act(() => marker?.focus());
    const addNote = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Add note",
    );
    act(() => addNote?.click());

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
}

function renderOverlay(
  selections: Selection[],
  currentSelectionId: string | null,
  overrides: Partial<React.ComponentProps<typeof SelectionOverlay>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <SelectionOverlay
        selections={selections}
        currentSelectionId={currentSelectionId}
        workflow={{ mode: "idle" }}
        busySelectionIds={new Set()}
        capturingSelectionIds={new Set()}
        onActivate={() => {}}
        onEditNote={() => {}}
        loadSnapshot={async () => {
          throw new Error("Snapshot loading is not expected in this test");
        }}
        onReposition={() => {}}
        registerAdjustment={() => {}}
        releaseAdjustment={() => {}}
        {...overrides}
      />,
    );
  });
}
