import { describe, expect, test } from "vite-plus/test";

import { INITIAL_UI_STATE, gestureAnchor, locksCompetingInteractions, uiReducer } from "@/state";
import { selectionFixture } from "@/test-fixtures";

describe("selection workflow", () => {
  test("returns to idle as soon as pointer release queues a selection", () => {
    const output = document.createElement("div");
    output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    Object.defineProperties(output, {
      scrollWidth: { value: 400 },
      scrollHeight: { value: 200 },
    });
    const armed = uiReducer(INITIAL_UI_STATE, { type: "arm" });
    const dragging = uiReducer(armed, {
      type: "startDrag",
      output: { id: "cell-1", element: output },
      pointerId: 4,
      point: { x: 20, y: 30 },
    });
    const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
    const queued = uiReducer(dragging, {
      type: "selectionQueued",
      pending: { selection },
    });

    expect(queued.workflow).toEqual({ mode: "idle" });
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
});
