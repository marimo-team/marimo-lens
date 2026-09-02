import type { AnyModel } from "@anywidget/types";
import type { CaptureResult } from "@marimo-lens/image-capture";
import type {
  AddressedSelection,
  LensResponse,
  LensState,
  Selection,
  SelectionTarget,
} from "@marimo-lens/protocol";

import { act, StrictMode, useLayoutEffect, useMemo, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { SelectionSnapshotCapture } from "@/selection/selection-capture";

import { LensProtocolClient } from "@/anywidget/client";
import { NotebookDomAdapter } from "@/notebook/notebook-dom";
import { documentIdentity } from "@/notebook/selection-target";
import { useSelectionActions } from "@/selection/selection-actions";
import { INITIAL_UI_STATE, uiReducer, type UiState } from "@/selection/state";

import { addressedSelectionFixture, selectionFixture } from "../support/fixtures";

type Actions = ReturnType<typeof useSelectionActions>;
const NOTEBOOK_TARGET: SelectionTarget = {
  kind: "notebook",
  cellIds: ["cell-1"],
  documentId: documentIdentity(document),
  documentPath: "/",
};

const captureSnapshot = vi.fn<SelectionSnapshotCapture>();
let root: Root | null = null;
let actions: Actions | null = null;
let latestUi: UiState | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  actions = null;
  latestUi = null;
  document.body.replaceChildren();
  captureSnapshot.mockReset();
  vi.unstubAllGlobals();
});

describe("selection mutations", () => {
  test("commits on pointer release before capturing the automatic snapshot", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));

    expect(latestUi?.workflow).toEqual({
      mode: "editingNote",
      selectionId: "selection-fixed",
      motion: "animate",
    });
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
    captureSnapshot.mockResolvedValue(failedCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();

    expect(stateRef.current.selections[0]).toMatchObject({
      note: "",
      snapshot: { status: "failed" },
    });
    expect(protocol.putSelection.mock.calls[1]?.[1]).toBe("clear");
  });

  test("does not persist or announce an iframe-originated capture cancellation", async () => {
    const output = visibleOutput();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const frameWindow = frame.contentWindow?.self;
    if (!frameWindow) throw new Error("Iframe window must be available");
    captureSnapshot.mockRejectedValue(
      new frameWindow.DOMException("Frame capture canceled", "AbortError"),
    );
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("pending");
    expect(latestUi?.announcement).toBe("S1 selected.");
    frame.remove();
  });

  test("settles a pending image after persistence fails", async () => {
    const output = visibleOutput();
    captureSnapshot.mockResolvedValue(availableCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    const persist = protocol.putSelection.getMockImplementation()!;
    protocol.putSelection
      .mockImplementationOnce(persist)
      .mockRejectedValueOnce(new Error("Image persistence failed"));
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();

    expect(stateRef.current.selections[0]?.snapshot).toMatchObject({
      status: "failed",
      error: "Snapshot capture did not complete.",
    });
    expect(latestUi?.announcement).toBe("Image persistence failed");
  });

  test("commits optimistic state when unavailable output cancels queued capture", async () => {
    const output = visibleOutput();
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    const committed = deferred<void>();
    const persist = protocol.putSelection.getMockImplementation()!;
    protocol.putSelection.mockImplementationOnce(async (...args) => {
      const response = await persist(...args);
      await committed.promise;
      return response;
    });
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stateRef.current.selections).toHaveLength(1);

    act(() => actions?.settleUnavailableSnapshot("selection-fixed"));
    committed.resolve();
    await flush();

    expect(latestUi?.pendingSelections).toEqual([]);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("failed");
  });

  test("settles an initial snapshot when its output disappears", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const signal = captureSignal();

    act(() => actions?.settleUnavailableSnapshot("selection-fixed"));
    await flush();

    expect(signal.aborted).toBe(true);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("failed");
    expect(protocol.putSelection.mock.calls[1]).toMatchObject([
      { snapshot: { status: "failed" } },
      "clear",
      1,
    ]);
  });

  test("retains an outdated snapshot when its replacement output disappears", async () => {
    visibleOutput();
    const prior = selectionFixture({ snapshot: availableCapture().snapshot.metadata });
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState(2, [prior], prior.id, "S2") };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.repositionSelection(prior, { kind: "point", x: 0.7, y: 0.6 }));
    await flush();
    const signal = captureSignal();

    act(() => actions?.settleUnavailableSnapshot(prior.id));
    await flush();

    expect(signal.aborted).toBe(true);
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("outdated");
  });

  test("rejects marked pixels from a replaced canonical output root", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    output.replaceWith(replacementOutput());

    capture.resolve(availableCapture());
    await flush();

    expect(stateRef.current.selections[0]?.snapshot.status).toBe("failed");
    expect(protocol.putSelection.mock.calls[1]).toEqual([
      expect.objectContaining({ snapshot: expect.objectContaining({ status: "failed" }) }),
      "clear",
      1,
      undefined,
    ]);
  });

  test("keeps prior pixels when a replacement root invalidates marked capture", async () => {
    const output = visibleOutput();
    const prior = selectionFixture({ snapshot: availableCapture().snapshot.metadata });
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState(2, [prior], prior.id, "S2") };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.repositionSelection(prior, { kind: "point", x: 0.7, y: 0.6 }));
    await flush();
    output.replaceWith(replacementOutput());

    capture.resolve(availableCapture());
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("outdated");
  });

  test("suppresses an automatic snapshot after its selection is resolved", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    const signal = captureSignal();

    act(() => actions?.invalidateSnapshotCapture("selection-fixed"));
    expect(signal.aborted).toBe(true);
    stateRef.current = {
      ...stateRef.current,
      revision: 2,
      currentSelectionId: null,
      selections: [],
    };
    capture.resolve(availableCapture());
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Image ready.");
  });

  test("suppresses a completed snapshot when canonical state removed the selection", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const signal = captureSignal();
    stateRef.current = {
      ...stateRef.current,
      revision: 2,
      currentSelectionId: null,
      selections: [],
    };
    rerender(stateRef, protocol.client);
    expect(signal.aborted).toBe(true);

    capture.resolve(availableCapture());
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Image ready.");
  });

  test("does not start a queued automatic snapshot after resolution", async () => {
    const output = visibleOutput();
    captureSnapshot.mockResolvedValue(availableCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => {
      beginPointSelection(output);
      actions?.invalidateSnapshotCapture("selection-fixed");
    });
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(latestUi?.announcement).not.toBe("Image ready.");
  });

  test("commits a selection when development mode replays effects", async () => {
    const output = visibleOutput();
    captureSnapshot.mockResolvedValue(failedCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client, true);

    act(() => beginPointSelection(output));
    await flush();

    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(stateRef.current.selections).toHaveLength(1);
    expect(stateRef.current.currentSelectionId).toBe("selection-fixed");
  });

  test("settles a detached pending capture when deletion fails", async () => {
    const output = visibleOutput();
    const interrupted = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(interrupted.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    protocol.deleteSelection.mockRejectedValueOnce(new Error("Remove failed"));
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    output.remove();
    act(() => actions?.deleteSelection(stateRef.current.selections[0]!));
    await flush();

    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("pending");
    expect(captureSignal().aborted).toBe(false);

    interrupted.resolve(availableCapture());
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("failed");
  });

  test("settles detached pending captures when clearing fails", async () => {
    const output = visibleOutput();
    const interrupted = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(interrupted.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    protocol.clearSelections.mockRejectedValueOnce(new Error("Clear failed"));
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    output.remove();
    act(() => actions?.clearSelections());
    await flush();

    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("pending");
    expect(captureSignal().aborted).toBe(false);

    interrupted.resolve(availableCapture());
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(2);
    expect(stateRef.current.selections[0]?.snapshot.status).toBe("failed");
  });

  test("suppresses a pending capture after deletion succeeds", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const signal = captureSignal();
    act(() => actions?.deleteSelection(stateRef.current.selections[0]!));
    await flush();

    expect(signal.aborted).toBe(true);
    capture.resolve(availableCapture());
    await flush();
    expect(stateRef.current.selections).toEqual([]);
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Image ready.");
  });

  test("keeps another selection note open after deletion completes", async () => {
    const first = selectionFixture();
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const stateRef = {
      current: lensState(2, [first, second], second.id, "S3"),
    };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.openNote(second.id, "instant"));
    expect(latestUi?.workflow).toMatchObject({
      mode: "editingNote",
      selectionId: second.id,
    });

    act(() => actions?.deleteSelection(first));
    await flush();

    expect(latestUi?.workflow).toMatchObject({
      mode: "editingNote",
      selectionId: second.id,
    });
  });

  test("suppresses pending captures after clearing succeeds", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const signal = captureSignal();
    act(() => actions?.clearSelections());
    await flush();

    expect(signal.aborted).toBe(true);
    capture.resolve(availableCapture());
    await flush();
    expect(stateRef.current.selections).toEqual([]);
    expect(protocol.putSelection).toHaveBeenCalledTimes(1);
    expect(latestUi?.announcement).not.toBe("Image ready.");
  });

  test("aborts a pending raster when reposition starts its replacement", async () => {
    const output = visibleOutput();
    const firstCapture = deferred<CaptureResult>();
    captureSnapshot
      .mockReturnValueOnce(firstCapture.promise)
      .mockResolvedValueOnce(failedCapture());
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const firstSignal = captureSignal(0);

    act(() =>
      actions?.repositionSelection(stateRef.current.selections[0]!, {
        kind: "point",
        x: 0.7,
        y: 0.6,
      }),
    );
    await flush();

    expect(captureSnapshot).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
    expect(captureSignal(1).aborted).toBe(false);
    const committedCalls = protocol.putSelection.mock.calls.length;

    firstCapture.resolve(availableCapture());
    await flush();
    expect(protocol.putSelection).toHaveBeenCalledTimes(committedCalls);
  });

  test("keeps the current raster when repositioning fails before replacement", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const signal = captureSignal();
    protocol.putSelection.mockRejectedValueOnce(new Error("Adjust failed"));

    act(() =>
      actions?.repositionSelection(stateRef.current.selections[0]!, {
        kind: "point",
        x: 0.7,
        y: 0.6,
      }),
    );
    await flush();

    expect(signal.aborted).toBe(false);
    capture.resolve(availableCapture());
    await flush();
    expect(stateRef.current.selections[0]).toMatchObject({
      anchor: { kind: "point", x: 0.4, y: 0.5 },
      snapshot: { status: "available" },
    });
  });

  test("aborts pending selection capture during teardown", async () => {
    const output = visibleOutput();
    const capture = deferred<CaptureResult>();
    captureSnapshot.mockReturnValue(capture.promise);
    const stateRef = { current: lensState() };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => beginPointSelection(output));
    await flush();
    const signal = captureSignal();

    act(() => root?.unmount());
    root = null;

    expect(signal.aborted).toBe(true);
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
    const protocol = protocolClient();
    vi.spyOn(protocol, "activateSelection").mockImplementation(activateSelection);
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
    captureSnapshot.mockReturnValue(capture.promise);
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
    expect(latestUi?.announcement).toBe(
      "Previous image retained. Move or reselect to capture a new observation.",
    );
  });

  test("reopens an exact receipt as current and captures fresh pixels", async () => {
    const output = visibleOutput();
    const receipt = addressedSelectionFixture();
    captureSnapshot.mockResolvedValue(availableCapture(receipt.selectionId));
    const stateRef = {
      current: lensState(4, [], null, "S2", [receipt]),
    };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.reopenSelection(receipt));
    await flush();
    await flush();

    expect(protocol.reopenSelection).toHaveBeenCalledWith(
      receipt.selectionId,
      receipt.resolutionRevision,
      4,
    );
    expect(stateRef.current.currentSelectionId).toBe(receipt.selectionId);
    expect(stateRef.current.history).toEqual([receipt]);
    expect(stateRef.current.selections[0]).toMatchObject({
      id: receipt.selectionId,
      label: receipt.label,
      note: receipt.note,
      target: receipt.target,
      previousResolution: {
        addressedAt: receipt.addressedAt,
        summary: receipt.summary,
      },
      snapshot: { status: "available" },
    });
    expect(captureSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionId: receipt.selectionId,
        output,
      }),
    );
    expect(latestUi?.sheetTab).toBe("open");
    expect(latestUi?.announcement).toBe("Image ready.");
  });

  test("clears addressed history while preserving open selections", async () => {
    const selection = selectionFixture();
    const receipt = addressedSelectionFixture();
    const stateRef = {
      current: lensState(4, [selection], selection.id, "S2", [receipt]),
    };
    const protocol = statefulProtocol(stateRef);
    mount(stateRef, protocol.client);

    act(() => actions?.clearHistory());
    await flush();

    expect(protocol.clearHistory).toHaveBeenCalledWith(4);
    expect(stateRef.current.history).toEqual([]);
    expect(stateRef.current.selections).toEqual([selection]);
    expect(stateRef.current.currentSelectionId).toBe(selection.id);
    expect(latestUi?.sheetTab).toBe("open");
    expect(latestUi?.announcement).toBe("History cleared.");
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

function rerender(stateRef: { current: LensState }, protocol: LensProtocolClient): void {
  act(() => root?.render(<Harness stateRef={stateRef} protocol={protocol} />));
}

function Harness({
  stateRef,
  protocol,
}: {
  stateRef: { current: LensState };
  protocol: LensProtocolClient;
}) {
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const dom = useMemo(() => new NotebookDomAdapter(document), []);
  const hookActions = useSelectionActions({
    stateRef,
    dispatch,
    dom,
    selector: null,
    protocol,
    captureSnapshot,
  });
  useLayoutEffect(() => {
    actions = hookActions;
    latestUi = ui;
  }, [hookActions, ui]);
  return null;
}

function statefulProtocol(stateRef: { current: LensState }) {
  const client = protocolClient();
  const putSelection = vi
    .spyOn(client, "putSelection")
    .mockImplementation(
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
          history: stateRef.current.history,
        };
        return successResponse(revision);
      },
    );
  const activateSelection = vi
    .spyOn(client, "activateSelection")
    .mockImplementation(async (selectionId: string, expectedRevision: number) => {
      const revision = expectedRevision + 1;
      stateRef.current = { ...stateRef.current, revision, currentSelectionId: selectionId };
      return successResponse(revision);
    });
  const deleteSelection = vi
    .spyOn(client, "deleteSelection")
    .mockImplementation(async (selectionId: string, expectedRevision: number) => {
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
  const clearSelections = vi
    .spyOn(client, "clearSelections")
    .mockImplementation(async (expectedRevision: number) => {
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
  const reopenSelection = vi
    .spyOn(client, "reopenSelection")
    .mockImplementation(
      async (selectionId: string, resolutionRevision: number, expectedRevision: number) => {
        expect(expectedRevision).toBe(stateRef.current.revision);
        const receipt = stateRef.current.history.find(
          (candidate) =>
            candidate.selectionId === selectionId &&
            candidate.resolutionRevision === resolutionRevision,
        );
        if (!receipt) throw new Error("Receipt fixture unavailable");
        const revision = expectedRevision + 1;
        stateRef.current = {
          ...stateRef.current,
          revision,
          currentSelectionId: receipt.selectionId,
          selections: [...stateRef.current.selections, reopenedSelection(receipt)],
        };
        return successResponse(revision);
      },
    );
  const clearHistory = vi
    .spyOn(client, "clearHistory")
    .mockImplementation(async (expectedRevision: number) => {
      expect(expectedRevision).toBe(stateRef.current.revision);
      const revision = expectedRevision + 1;
      stateRef.current = {
        ...stateRef.current,
        revision,
        history: [],
      };
      return successResponse(revision);
    });
  return {
    client,
    putSelection,
    activateSelection,
    deleteSelection,
    clearSelections,
    reopenSelection,
    clearHistory,
  };
}

function protocolClient(): LensProtocolClient {
  const model = {
    get() {
      throw new Error("Protocol client model reads are not expected");
    },
    set() {},
    off() {},
    on() {},
    save_changes() {},
    send() {},
    widget_manager: {
      async get_model() {
        throw new Error("Nested model reads are not expected");
      },
    },
  } satisfies AnyModel;
  return new LensProtocolClient(model, window);
}

function lensState(
  revision = 0,
  selections: Selection[] = [],
  currentSelectionId: string | null = null,
  next = "S1",
  history: AddressedSelection[] = [],
): LensState {
  return { revision, nextLabel: next, currentSelectionId, selections, history };
}

function availableCapture(
  selectionId = "selection-fixed",
): Extract<CaptureResult, { status: "available" }> {
  return {
    status: "available",
    snapshot: {
      metadata: {
        status: "available",
        id: `image:${selectionId}`,
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

function reopenedSelection(receipt: AddressedSelection): Selection {
  const previousResolution: NonNullable<Selection["previousResolution"]> = {
    addressedAt: receipt.addressedAt,
  };
  if (receipt.summary) previousResolution.summary = receipt.summary;
  const selection: Selection = {
    id: receipt.selectionId,
    label: receipt.label,
    note: receipt.note,
    target: receipt.target,
    createdAt: receipt.createdAt,
    anchor: receipt.anchor,
    snapshot: {
      status: "pending",
    },
    previousResolution,
  };
  if (receipt.domHint) selection.domHint = receipt.domHint;
  return selection;
}

function captureSignal(index = 0): AbortSignal {
  const signal = captureSnapshot.mock.calls[index]?.[0].signal;
  if (!signal) throw new Error(`Capture ${index + 1} has no abort signal`);
  return signal;
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

function beginPointSelection(output: HTMLElement): void {
  actions?.beginSelection(NOTEBOOK_TARGET, output, { kind: "point", x: 0.4, y: 0.5 }, output);
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

function replacementOutput(): HTMLElement {
  const output = document.createElement("div");
  output.id = "output-cell-1";
  output.getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
  Object.defineProperties(output, {
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 240 },
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
    version: 4,
    requestId: "request-1",
    ok: true,
    revision,
    payload: {},
  };
}
