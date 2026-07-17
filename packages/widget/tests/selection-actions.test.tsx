import { act, StrictMode, useLayoutEffect, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensResponse, LensState, Selection } from "@/contracts";
import type { LensProtocolClient } from "@/protocol";
import type { CaptureResult } from "@/types";

import { captureSelectionSnapshot } from "@/capture/image";
import { useSelectionActions } from "@/selection-actions";
import { INITIAL_UI_STATE, uiReducer, type UiState } from "@/state";

import { selectionFixture } from "./test-fixtures";

vi.mock("@/capture/image", () => ({ captureSelectionSnapshot: vi.fn() }));

type Actions = ReturnType<typeof useSelectionActions>;

let root: Root | null = null;
let actions: Actions | null = null;
let latestUi: UiState | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  actions = null;
  latestUi = null;
  document.body.replaceChildren();
  vi.mocked(captureSelectionSnapshot).mockReset();
  vi.unstubAllGlobals();
});

describe("selection mutations", () => {
  test("commits on pointer release before capturing the automatic snapshot", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));

    expect(latestUi?.workflow).toEqual({ mode: "idle" });
    expect(latestUi?.pendingSelections[0]?.selection).toMatchObject({
      label: "S1",
      note: "",
      snapshot: { status: "pending" },
    });
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(protocol.putSelection.mock.calls[0]).toMatchObject([
      { label: "S1", note: "", snapshot: { status: "pending" } },
      "clear",
      0,
    ]);
    expect(stateRef.current.currentSelectionId).toBe("selection-fixed");

    capture.resolve(availableCapture());
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(protocol.putSelection.mock.calls[1]).toMatchObject([
      { snapshot: { status: "available" } },
      "replace",
      1,
      new Uint8Array([137, 80, 78, 71]),
    ]);
  });

  test("keeps a text-ready selection when initial capture fails", async () => {
    const output = visibleOutput();
    vi.mocked(captureSelectionSnapshot).mockResolvedValue(failedCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();

    expect(stateRef.current.selections[0]).toMatchObject({
      note: "",
      snapshot: { status: "failed" },
    });
    expect(protocol.putSelection.mock.calls[1]?.[1]).toBe("clear");
  });

  test("suppresses an automatic snapshot after its selection is resolved", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);

    act(() => actions?.invalidateSnapshotCapture("selection-fixed"));
    stateRef.current = {
      ...stateRef.current,
      revision: 2,
      currentSelectionId: null,
      selections: [],
    };
    capture.resolve(availableCapture());
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Snapshot ready.");
  });

  test("suppresses a completed snapshot when canonical state removed the selection", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();
    stateRef.current = {
      ...stateRef.current,
      revision: 2,
      currentSelectionId: null,
      selections: [],
    };

    capture.resolve(availableCapture());
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Snapshot ready.");
  });

  test("does not start a queued automatic snapshot after resolution", async () => {
    const output = visibleOutput();
    vi.mocked(captureSelectionSnapshot).mockResolvedValue(availableCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => {
      actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output);
      actions?.invalidateSnapshotCapture("selection-fixed");
    });
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(captureSelectionSnapshot).not.toHaveBeenCalled();
    expect(latestUi?.announcement).not.toBe("Snapshot ready.");
  });

  test("commits a selection when development mode replays effects", async () => {
    const output = visibleOutput();
    vi.mocked(captureSelectionSnapshot).mockResolvedValue(failedCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client, true);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(stateRef.current.selections).toHaveLength(1);
    expect(stateRef.current.currentSelectionId).toBe("selection-fixed");
  });

  test("continues a detached pending capture when deletion fails", async () => {
    const output = visibleOutput();
    const interrupted = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(interrupted.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    protocol.deleteSelection.mockRejectedValueOnce(new Error("Remove failed"));
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();
    output.remove();
    act(() => actions?.deleteSelection(stateRef.current.selections[0]!));
    await flush();

    expect(captureSelectionSnapshot).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("pending");

    interrupted.resolve(availableCapture());
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("available");
  });

  test("continues detached pending captures when clearing fails", async () => {
    const output = visibleOutput();
    const interrupted = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(interrupted.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    protocol.clearSelections.mockRejectedValueOnce(new Error("Clear failed"));
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();
    output.remove();
    act(() => actions?.clearSelections());
    await flush();

    expect(captureSelectionSnapshot).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("pending");

    interrupted.resolve(availableCapture());
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("available");
  });

  test("suppresses a pending capture after deletion succeeds", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();
    act(() => actions?.deleteSelection(stateRef.current.selections[0]!));
    await flush();

    capture.resolve(availableCapture());
    await flush();
    expect(stateRef.current.selections).toEqual([]);
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Snapshot ready.");
  });

  test("suppresses pending captures after clearing succeeds", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.beginSelection("cell-1", output, { kind: "point", x: 0.4, y: 0.5 }, output));
    await flush();
    act(() => actions?.clearSelections());
    await flush();

    capture.resolve(availableCapture());
    await flush();
    expect(stateRef.current.selections).toEqual([]);
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Snapshot ready.");
  });

  test("activates an older selection and saves an empty optional note", async () => {
    const first = selectionFixture({ id: "selection-1", label: "S1", note: "Original" });
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const stateRef = {
      current: lensState(4, [first, second], "selection-2", "S3"),
    };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.openNote(first.id));
    await flush();
    expect(protocol.activateSelection).toHaveBeenCalledWith(first.id, 4);
    expect(stateRef.current.currentSelectionId).toBe(first.id);

    act(() => actions?.saveNote(first.id, ""));
    await flush();
    expect(stateRef.current.selections.find(({ id }) => id === first.id)?.note).toBe("");
    expect(protocol.putSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: first.id, note: "" }),
      "preserve",
      5,
    );
  });

  test("serializes same-view mutations against the latest revision", async () => {
    const first = selectionFixture({ id: "selection-1", label: "S1" });
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const stateRef = { current: lensState(1, [first, second], first.id, "S3") };
    let finishFirst!: () => void;
    const activateSelection = vi.fn((selectionId: string, expectedRevision: number) => {
      if (activateSelection.mock.calls.length === 1) {
        return new Promise<LensResponse>((resolve) => {
          finishFirst = () => {
            stateRef.current = {
              ...stateRef.current,
              revision: expectedRevision + 1,
              currentSelectionId: selectionId,
            };
            resolve(successResponse(expectedRevision + 1));
          };
        });
      }
      stateRef.current = {
        ...stateRef.current,
        revision: expectedRevision + 1,
        currentSelectionId: selectionId,
      };
      return Promise.resolve(successResponse(expectedRevision + 1));
    });
    const protocol = {
      putSelection: vi.fn(),
      activateSelection,
      deleteSelection: vi.fn(),
      clearSelections: vi.fn(),
      exportContext: vi.fn(),
    } as unknown as LensProtocolClient;
    mount(stateRef, protocol);

    act(() => {
      actions?.activateSelection(second.id);
      actions?.activateSelection(first.id);
    });
    await Promise.resolve();
    expect(activateSelection).toHaveBeenCalledTimes(1);
    expect(activateSelection).toHaveBeenNthCalledWith(1, second.id, 1);

    finishFirst();
    await flush();
    expect(activateSelection).toHaveBeenCalledTimes(2);
    expect(activateSelection).toHaveBeenNthCalledWith(2, first.id, 2);
  });

  test("retains an outdated prior snapshot when reposition capture fails", async () => {
    visibleOutput();
    const prior = selectionFixture({ snapshot: availableCapture().snapshot.metadata });
    const stateRef = { current: lensState(2, [prior], prior.id, "S2") };
    const protocol = statefulProtocol(stateRef);
    const capture = deferred<CaptureResult>();
    vi.mocked(captureSelectionSnapshot).mockReturnValue(capture.promise);
    mount(stateRef, protocol.client);

    act(() => actions?.repositionSelection(prior, { kind: "point", x: 0.7, y: 0.6 }));
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.objectContaining({ status: "outdated" }) }),
      "preserve",
      2,
    );
    capture.resolve(failedCapture());
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("outdated");
    expect(latestUi?.announcement).toBe("Snapshot refresh failed. Previous snapshot retained.");
  });
});

function mount(
  stateRef: { current: LensState },
  protocol: LensProtocolClient,
  strict = false,
): void {
  vi.stubGlobal("crypto", { randomUUID: () => "selection-fixed" });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const harness = <Harness stateRef={stateRef} protocol={protocol} />;
  act(() => root?.render(strict ? <StrictMode>{harness}</StrictMode> : harness));
}

function Harness({
  stateRef,
  protocol,
}: {
  stateRef: { current: LensState };
  protocol: LensProtocolClient;
}) {
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const hookActions = useSelectionActions({
    stateRef,
    dispatch,
    protocol,
  });
  useLayoutEffect(() => {
    actions = hookActions;
    latestUi = ui;
  }, [hookActions, ui]);
  return null;
}

function statefulProtocol(stateRef: { current: LensState }) {
  const putSelection = vi.fn(
    async (selection: Selection, _imageAction: string, expectedRevision: number) => {
      expect(expectedRevision).toBe(stateRef.current.revision);
      const index = stateRef.current.selections.findIndex(({ id }) => id === selection.id);
      const selections = [...stateRef.current.selections];
      if (index < 0) selections.push(selection);
      else selections[index] = selection;
      const created = index < 0;
      const revision = expectedRevision + 1;
      stateRef.current = {
        revision,
        nextLabel: created ? nextLabel(selection.label) : stateRef.current.nextLabel,
        currentSelectionId: created ? "selection-fixed" : stateRef.current.currentSelectionId,
        selections,
      };
      return successResponse(revision);
    },
  );
  const activateSelection = vi.fn(async (selectionId: string, expectedRevision: number) => {
    const revision = expectedRevision + 1;
    stateRef.current = { ...stateRef.current, revision, currentSelectionId: selectionId };
    return successResponse(revision);
  });
  const deleteSelection = vi.fn(async (selectionId: string, expectedRevision: number) => {
    expect(expectedRevision).toBe(stateRef.current.revision);
    const revision = expectedRevision + 1;
    const selections = stateRef.current.selections.filter(({ id }) => id !== selectionId);
    stateRef.current = {
      ...stateRef.current,
      revision,
      currentSelectionId: selections.at(-1)?.id ?? null,
      selections,
    };
    return successResponse(revision);
  });
  const clearSelections = vi.fn(async (expectedRevision: number) => {
    expect(expectedRevision).toBe(stateRef.current.revision);
    const revision = expectedRevision + 1;
    stateRef.current = {
      ...stateRef.current,
      revision,
      currentSelectionId: null,
      selections: [],
    };
    return successResponse(revision);
  });
  const client = {
    putSelection,
    activateSelection,
    deleteSelection,
    clearSelections,
    exportContext: vi.fn(),
  } as unknown as LensProtocolClient;
  return { client, putSelection, activateSelection, deleteSelection, clearSelections };
}

function lensState(
  revision = 0,
  selections: Selection[] = [],
  currentSelectionId: string | null = null,
  next = "S1",
): LensState {
  return { revision, nextLabel: next, currentSelectionId, selections };
}

function availableCapture(): Extract<CaptureResult, { status: "available" }> {
  return {
    status: "available",
    snapshot: {
      metadata: {
        status: "available",
        id: "image:selection-fixed",
        mediaType: "image/png",
        width: 800,
        height: 600,
        sha256: "a".repeat(64),
        capturedAt: "2026-07-14T12:00:00Z",
      },
      bytes: new Uint8Array([137, 80, 78, 71]),
    },
  };
}

function failedCapture(): Extract<CaptureResult, { status: "failed" }> {
  return {
    status: "failed",
    snapshot: {
      status: "failed",
      capturedAt: "2026-07-14T12:00:00Z",
      error: "Canvas blocked",
    },
  };
}

function nextLabel(label: string): string {
  return `S${Number(label.slice(1)) + 1}`;
}

function visibleOutput(): HTMLElement {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
  Object.defineProperties(output, {
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 240 },
  });
  document.body.appendChild(output);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [output],
  });
  return output;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function successResponse(revision: number): LensResponse {
  return {
    protocol: "marimo-lens.response",
    version: 1,
    requestId: "request-1",
    ok: true,
    revision,
    payload: {},
  };
}
