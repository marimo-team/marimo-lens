import { describe, expect, test } from "vite-plus/test";

import {
  INITIAL_UI_STATE,
  gestureAnchor,
  locksCompetingInteractions,
  uiReducer,
} from "@/selection/state";

import { selectionFixture } from "../support/fixtures";

describe("selection workflow", () => {
  test("opens optional note editing as soon as pointer release queues a selection", () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    Object.defineProperties(output, {
      scrollWidth: { value: 400 },
      scrollHeight: { value: 200 },
    });
    const armed = uiReducer(INITIAL_UI_STATE, { type: "arm" });
    const dragging = uiReducer(armed, {
      type: "startDrag",
      target: {
        key: "cell-1",
        target: { kind: "notebook", cellIds: ["cell-1"] },
        element: output,
      },
      pointerId: 4,
      point: { x: 20, y: 30 },
    });
    const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
    const queued = uiReducer(dragging, {
      type: "selectionQueued",
      pending: { selection },
    });

    expect(queued.workflow).toEqual({
      mode: "editingNote",
      selectionId: selection.id,
      motion: "animate",
    });
    expect(queued.pendingSelections[0]?.selection).toEqual(selection);
    expect(queued.optimisticCurrentSelectionId).toBe(selection.id);
    expect(queued.announcement).toBe("S1 selected.");
  });

  test("commits a pending selection and preserves it as current", () => {
    const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
    const queued = uiReducer(INITIAL_UI_STATE, {
      type: "selectionQueued",
      pending: { selection },
    });
    const committed = uiReducer(queued, {
      type: "selectionCommitted",
      selectionId: selection.id,
      label: selection.label,
    });

    expect(committed.pendingSelections).toEqual([]);
    expect(committed.optimisticCurrentSelectionId).toBeNull();
  });

  test("preserves instant motion when a queued keyboard selection opens note editing", () => {
    const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
    const queued = uiReducer(INITIAL_UI_STATE, {
      type: "selectionQueued",
      pending: { selection },
      motion: "instant",
    });

    expect(queued.workflow).toEqual({
      mode: "editingNote",
      selectionId: selection.id,
      motion: "instant",
    });
  });

  test("opens optional note editing without changing selection identity", () => {
    const editing = uiReducer(INITIAL_UI_STATE, {
      type: "editNote",
      selectionId: "selection-1",
    });
    expect(editing.workflow).toEqual({
      mode: "editingNote",
      selectionId: "selection-1",
      motion: "animate",
    });
    expect(locksCompetingInteractions(editing)).toBe(true);
    expect(uiReducer(editing, { type: "closeNote" }).workflow).toEqual({ mode: "idle" });
  });

  test("keeps armed output focus stable across repeated pointer moves", () => {
    const target = {
      key: "cell-1",
      target: { kind: "notebook" as const, cellIds: ["cell-1"] },
      element: document.createElement("div"),
    };
    const armed = uiReducer(INITIAL_UI_STATE, { type: "arm" });
    const focused = uiReducer(armed, {
      type: "focusTarget",
      target,
    });

    expect(
      uiReducer(focused, {
        type: "focusTarget",
        target,
      }),
    ).toBe(focused);
  });

  test("preserves a newer activation when a history reopen completes", () => {
    const activated = uiReducer(INITIAL_UI_STATE, {
      type: "selectionActivated",
      selectionId: "selection-2",
    });
    const reopened = uiReducer(activated, {
      type: "historyReopened",
      selectionId: "selection-1",
      label: "S1",
    });

    expect(reopened.optimisticCurrentSelectionId).toBe("selection-2");
    expect(
      uiReducer(reopened, {
        type: "activationCommitted",
        selectionId: "selection-2",
      }).optimisticCurrentSelectionId,
    ).toBeNull();
  });

  test("treats a one-axis gesture as a point and a two-axis drag as a rectangle", () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
    Object.defineProperties(output, {
      scrollWidth: { value: 200 },
      scrollHeight: { value: 100 },
    });
    expect(gestureAnchor(output, { x: 10, y: 10 }, { x: 80, y: 12 })).toMatchObject({
      kind: "point",
    });
    const rectangle = gestureAnchor(output, { x: 10, y: 10 }, { x: 80, y: 60 });
    expect(rectangle).toMatchObject({
      kind: "rect",
      x: 0.05,
      y: 0.1,
      height: 0.5,
    });
    expect(rectangle.kind === "rect" ? rectangle.width : 0).toBeCloseTo(0.35);
  });

  test("normalizes a drag from viewport pixels into scaled output coordinates", () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(100, 50, 200, 100);
    Object.defineProperties(output, {
      offsetWidth: { value: 400 },
      offsetHeight: { value: 200 },
      scrollWidth: { value: 400 },
      scrollHeight: { value: 200 },
    });

    expect(gestureAnchor(output, { x: 150, y: 75 }, { x: 250, y: 125 })).toEqual({
      kind: "rect",
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
  });
});
