import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { LensDock } from "@/components/lens-dock";
import { selectionFixture } from "@/test-fixtures";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("quiet Lens puck", () => {
  test("starts as a compact labeled Select action", () => {
    renderDock({ selections: [] });

    expect(document.querySelector("[data-ml-select]")?.textContent).toBe("Select");
    expect(document.querySelector("[data-ml-list]")).toBeNull();
    expect(document.querySelector("[data-marimo-lens-selection-list]")).toBeNull();
  });

  test("opens the selection sheet and restores focus to the count", () => {
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
    expect(document.activeElement?.closest("[data-marimo-lens-selection-list]")).not.toBeNull();
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain(
      "Selected output",
    );

    const close = document.querySelector<HTMLButtonElement>(
      '[data-marimo-lens-selection-list] [aria-label="Close selections"]',
    )!;
    act(() => close.click());
    expect(document.activeElement).toBe(listTrigger);
  });

  test("offers note editing after selection creation", () => {
    const selection = selectionFixture({ note: "" });
    const onEditNote = vi.fn();
    renderDock({
      selections: [selection],
      currentSelectionId: selection.id,
      selectionReceipt: { selection },
      onEditNote,
    });

    const addNote = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Add note",
    );
    act(() => addNote?.click());
    expect(onEditNote).toHaveBeenCalledWith(selection);
  });

  test("shows one-shot selection mode and its escape hint", () => {
    renderDock({ armed: true });

    const select = document.querySelector<HTMLButtonElement>("[data-ml-select]")!;
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.textContent).toContain("Click or drag");
    expect(select.textContent).toContain("ESC");
  });

  test("makes a keyboard-focused selection row current", () => {
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
    );
    act(() => secondRow?.focus());
    expect(onActivateSelection).toHaveBeenCalledOnce();
    expect(onActivateSelection).toHaveBeenCalledWith(second);
  });
});

function DockHarness() {
  const [listOpen, setListOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <LensDock
      {...defaultProps()}
      selections={[selectionFixture({ note: "" })]}
      currentSelectionId="selection-1"
      listOpen={listOpen}
      menuOpen={menuOpen}
      onToggleList={() => {
        setListOpen((open) => !open);
        setMenuOpen(false);
      }}
      onToggleMenu={() => {
        setMenuOpen((open) => !open);
        setListOpen(false);
      }}
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
    armed: false,
    listOpen: false,
    menuOpen: false,
    exportState: { status: "idle" },
    capturingSelectionIds: new Set(),
    busySelectionIds: new Set(),
    interactionLocked: false,
    onToggleArmed: () => {},
    onToggleList: () => {},
    onToggleMenu: () => {},
    onCopyContext: () => {},
    onClearSelections: () => {},
    onActivateSelection: () => {},
    onEditNote: () => {},
    onDeleteSelection: () => {},
  };
}
