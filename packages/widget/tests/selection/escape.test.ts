import { describe, expect, test, vi } from "vite-plus/test";

import type { UiAction, UiState } from "@/selection/state";

import { handleLensEscape } from "@/selection/escape";

describe("Escape cancellation", () => {
  test("closes optional note editing and preserves the selection focus target", () => {
    const dispatch = vi.fn<(action: UiAction) => void>();
    const focusSelection = vi.fn();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

    handleLensEscape(event, {
      state: {
        ...INITIAL_IDLE_STATE,
        workflow: { mode: "editingNote", selectionId: "selection-1", motion: "animate" },
      },
      dispatch,
      cancelDrag: vi.fn(),
      cancelAdjustment: vi.fn(() => false),
      focusSelection,
      focusDock: vi.fn(),
      focusListTrigger: vi.fn(),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "closeNote" });
    expect(focusSelection).toHaveBeenCalledWith("selection-1");
  });

  test("cancels a drag before disarming", () => {
    const output = document.createElement("div");
    const cancelDrag = vi.fn();
    const dispatch = vi.fn<(action: UiAction) => void>();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

    handleLensEscape(event, {
      state: {
        ...INITIAL_IDLE_STATE,
        workflow: {
          mode: "dragging",
          output: { id: "cell-1", element: output },
          pointerId: 7,
          start: { x: 10, y: 10 },
          current: { x: 20, y: 20 },
        },
      },
      dispatch,
      cancelDrag,
      cancelAdjustment: vi.fn(() => false),
      focusSelection: vi.fn(),
      focusDock: vi.fn(),
      focusListTrigger: vi.fn(),
    });

    expect(cancelDrag).toHaveBeenCalledWith(7, output);
    expect(dispatch).toHaveBeenCalledWith({ type: "disarm" });
  });

  test("cancels active geometry adjustment first", () => {
    const cancelAdjustment = vi.fn(() => true);
    const dispatch = vi.fn<(action: UiAction) => void>();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

    handleLensEscape(event, {
      state: INITIAL_IDLE_STATE,
      dispatch,
      cancelDrag: vi.fn(),
      cancelAdjustment,
      focusSelection: vi.fn(),
      focusDock: vi.fn(),
      focusListTrigger: vi.fn(),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(cancelAdjustment).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

const INITIAL_IDLE_STATE: UiState = {
  workflow: { mode: "idle" },
  pendingSelections: [],
  optimisticCurrentSelectionId: null,
  busySelectionIds: [],
  clearPending: false,
  historyClearPending: false,
  listOpen: false,
  sheetTab: "open",
  focusedHistoryRevision: null,
  announcement: "",
};
