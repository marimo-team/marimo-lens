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

  test("copies the current reference directly and keeps expanded formats in the menu", () => {
    const onCopyContext = vi.fn();
    renderDock({
      selections: [selectionFixture()],
      currentSelectionId: "selection-1",
      menuOpen: true,
      onCopyContext,
    });

    act(() => document.querySelector<HTMLButtonElement>(".ml-dockbar__copy")?.click());
    expect(onCopyContext).toHaveBeenCalledWith("current");

    act(() => findButton("Copy all references")?.click());
    expect(onCopyContext).toHaveBeenLastCalledWith("references");
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
