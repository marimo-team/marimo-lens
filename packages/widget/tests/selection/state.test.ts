import { describe, expect, test } from "vite-plus/test";

import { INITIAL_UI_STATE, gestureAnchor, uiReducer } from "@/selection/state";

import { selectionFixture } from "../support/fixtures";

describe("selection workflow", () => {
  test("opens the requests sheet on Open whichever tab it closed on", () => {
    const onHistory = uiReducer(uiReducer(INITIAL_UI_STATE, { type: "toggleSheet" }), {
      type: "setSheetTab",
      tab: "history",
    });
    const closed = uiReducer(onHistory, { type: "toggleSheet" });

    const reopened = uiReducer(closed, { type: "toggleSheet" });

    expect(closed.sheetOpen).toBe(false);
    expect(reopened).toMatchObject({ sheetOpen: true, sheetTab: "open" });
  });

  test.each([
    { gesture: "pointer release", motion: undefined, expected: "animate" },
    { gesture: "keyboard selection", motion: "instant", expected: "instant" },
  ] as const)(
    "opens optional note editing as soon as a $gesture queues a selection",
    ({ motion, expected }) => {
      const selection = selectionFixture({ note: "", snapshot: { status: "pending" } });
      const armed = uiReducer(INITIAL_UI_STATE, { type: "arm" });

      const queued = uiReducer(armed, { type: "selectionQueued", selection, motion });

      expect(queued.workflow).toEqual({
        mode: "editingNote",
        selectionId: selection.id,
        motion: expected,
      });
      expect(queued.pendingSelections[0]).toEqual(selection);
      expect(queued.optimisticCurrentSelectionId).toBe(selection.id);
      expect(queued.announcement).toBe("S1 selected.");
    },
  );

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
    expect(uiReducer(editing, { type: "closeNote" }).workflow).toEqual({ mode: "idle" });
  });

  test("keeps armed output focus stable across repeated pointer moves", () => {
    const target = {
      key: "cell-1",
      target: {
        kind: "notebook" as const,
        cellIds: ["cell-1"],
        documentId: "document-1",
        documentPath: "/",
      },
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
      label: "S1",
    });

    expect(reopened.optimisticCurrentSelectionId).toBe("selection-2");
    expect(
      uiReducer(reopened, {
        type: "activationSettled",
        selectionId: "selection-2",
      }).optimisticCurrentSelectionId,
    ).toBeNull();
  });

  test("preserves another note draft when an earlier save completes", () => {
    const saving = uiReducer(INITIAL_UI_STATE, {
      type: "mutationStarted",
      selectionId: "selection-1",
    });
    const editing = uiReducer(saving, {
      type: "editNote",
      selectionId: "selection-2",
    });

    const succeeded = uiReducer(editing, {
      type: "noteSaveSucceeded",
      selectionId: "selection-1",
      label: "S1",
    });
    expect(succeeded.workflow).toEqual(editing.workflow);
    expect(succeeded.busySelectionIds.size).toBe(0);

    const failed = uiReducer(editing, {
      type: "noteSaveFailed",
      selectionId: "selection-1",
      message: "Connection lost",
    });
    expect(failed.workflow).toEqual(editing.workflow);
    expect(failed.busySelectionIds.size).toBe(0);
    expect(failed.announcement).toBe("Connection lost");
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
