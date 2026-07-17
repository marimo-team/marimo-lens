import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { LensDock } from "@/components/lens-dock";

import { selectionFixture } from "../test-fixtures";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Lens dock", () => {
  test("starts with an explicit Select action and a latched collapse control", () => {
    renderDock({ selections: [] });

    expect(document.querySelector("[data-ml-select]")?.textContent).toBe("Select");
    expect(document.querySelector("[data-ml-list]")).toBeNull();

    act(() => findButton("Collapse Lens")?.click());
    expect(findButton("Open Lens")).not.toBeNull();
    act(() => {
      findButton("Open Lens")?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    });
    expect(findButton("Open Lens")).not.toBeNull();
    act(() => findButton("Open Lens")?.click());
    expect(document.querySelector("[data-ml-select]")).not.toBeNull();
  });

  test("announces the selection count from the collapsed dock", () => {
    renderDock({
      selections: [selectionFixture(), selectionFixture({ id: "selection-2", label: "S2" })],
    });

    act(() => findButton("Collapse Lens")?.click());

    expect(findButton("Open Lens, 2 selections")).not.toBeNull();
  });

  test("opens the selection sheet and restores focus to its trigger", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<DockHarness />));

    const listTrigger = document.querySelector<HTMLButtonElement>("[data-ml-list]")!;
    act(() => listTrigger.click());
    expect(document.activeElement?.classList.contains("ml-selection-list__summary")).toBe(true);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain("Cell cell-1");

    const close = findButton("Close selections")!;
    act(() => close.click());
    expect(document.activeElement).toBe(listTrigger);
  });

  test("keeps one-shot selection mode within a stable action slot", () => {
    renderDock({ armed: true });

    const select = document.querySelector<HTMLButtonElement>("[data-ml-select]")!;
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.textContent).toContain("Click or drag");
    expect(select.textContent).toContain("ESC");
  });

  test("focuses rows without activation and activates through an explicit command", () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const onActivateSelection = vi.fn();
    renderDock({
      selections: [first, second],
      currentSelectionId: first.id,
      listOpen: true,
      onActivateSelection,
    });

    const secondRow = document.querySelector<HTMLButtonElement>(
      '[aria-label^="Activate selection S2"]',
    )!;
    act(() => secondRow.focus());
    expect(onActivateSelection).not.toHaveBeenCalled();
    act(() => secondRow.click());
    expect(onActivateSelection).toHaveBeenCalledWith(second, "instant");
  });

  test("keeps the dock focused on selecting and opening selections", () => {
    renderDock({ selections: [selectionFixture()], currentSelectionId: "selection-1" });

    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".ml-dockbar button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Select an output", "Open 1 selection", "Collapse Lens"]);
  });

  test("keeps bulk clearing in the selection sheet", () => {
    const onClearSelections = vi.fn();
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      listOpen: true,
      onClearSelections,
    });

    act(() => findButton("Clear selections")?.click());
    expect(onClearSelections).toHaveBeenCalledOnce();
  });

  test("keeps a detached selection actionable and labels its unavailable output", () => {
    const selection = selectionFixture();
    const onActivateSelection = vi.fn();
    const onEditNote = vi.fn();
    const onDeleteSelection = vi.fn();
    renderDock({
      selections: [selection],
      currentSelectionId: selection.id,
      availableOutputCellIds: new Set(),
      listOpen: true,
      onActivateSelection,
      onEditNote,
      onDeleteSelection,
    });

    const summary = document.querySelector<HTMLButtonElement>('[aria-label*="Output unavailable"]');
    expect(summary?.textContent).toContain("Output unavailable");
    expect(summary?.getAttribute("aria-current")).toBe("true");
    expect(findButton("Snapshot ready for S1. Preview image.")?.disabled).toBe(false);
    expect(findButton("Edit note for S1")?.disabled).toBe(false);
    expect(findButton("Remove selection S1")?.disabled).toBe(false);

    act(() => summary?.click());
    expect(onActivateSelection).toHaveBeenCalledWith(selection, "instant");
    act(() => findButton("Edit note for S1")?.click());
    expect(onEditNote).toHaveBeenCalledWith(selection, "instant");
    act(() => findButton("Remove selection S1")?.click());
    expect(onDeleteSelection).toHaveBeenCalledWith(selection);
  });
});

function DockHarness() {
  const [listOpen, setListOpen] = useState(false);
  return (
    <LensDock
      {...defaultProps()}
      selections={[selectionFixture({ note: "" })]}
      currentSelectionId="selection-1"
      listOpen={listOpen}
      onToggleList={() => setListOpen((open) => !open)}
    />
  );
}

function renderDock(overrides: Partial<React.ComponentProps<typeof LensDock>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<LensDock {...defaultProps()} {...overrides} />));
}

function defaultProps(): React.ComponentProps<typeof LensDock> {
  return {
    selections: [],
    currentSelectionId: null,
    availableOutputCellIds: new Set(),
    armed: false,
    listOpen: false,
    clearPending: false,
    capturingSelectionIds: new Set(),
    busySelectionIds: new Set(),
    interactionLocked: false,
    onToggleArmed: () => {},
    onToggleList: () => {},
    onClearSelections: () => {},
    onActivateSelection: () => {},
    onEditNote: () => {},
    onDeleteSelection: () => {},
    loadSnapshot: async () => {
      throw new Error("Snapshot fixture unavailable");
    },
  };
}

function findButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        button.textContent?.trim() === label || button.getAttribute("aria-label") === label,
    ) ?? null
  );
}
