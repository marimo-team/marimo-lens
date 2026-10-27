import type {
  HistoryEntry,
  LensState,
  Selection,
  SelectionAnchor,
  SelectionTarget,
} from "@marimo-lens/protocol";

import { isAbortCause } from "@marimo-lens/protocol";
import { useCallback, useEffect, useMemo, type Dispatch, type RefObject } from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { SelectionSnapshotCapture } from "@/selection/selection-capture";
import type { SelectionMotion, UiAction } from "@/selection/state";

import { errorMessage } from "@/anywidget/error";
import { documentIdentity, targetBelongsToDocument } from "@/notebook/document-identity";
import { targetInfo } from "@/notebook/target-info";
import { anchorCenter, sameAnchor } from "@/selection/anchor";
import { collectDomHint } from "@/selection/dom-hint";
import { revealSelection } from "@/selection/reveal";
import { SelectionCapture, type SelectionCaptureJob } from "@/selection/selection-capture";
import { focusDock, focusSelectionOrDock } from "@/ui/focus";

import { useRevisionedMutations } from "./revisioned-mutations";

export function useSelectionActions(options: {
  stateRef: RefObject<LensState>;
  dispatch: Dispatch<UiAction>;
  dom: NotebookDomAdapter;
  protocol: LensProtocolClient;
  /** The open selections this view shows, and those whose target it shows. */
  selections: readonly Selection[];
  availableSelectionIds: ReadonlySet<string>;
  captureSnapshot?: SelectionSnapshotCapture;
}) {
  const { stateRef, dispatch, dom, protocol, selections, availableSelectionIds, captureSnapshot } =
    options;
  const { currentSignal, revise, mutate } = useRevisionedMutations(stateRef, dom.window, dispatch);

  const selectionCapture = useMemo(
    () =>
      new SelectionCapture({
        stateRef,
        dom,
        protocol,
        currentSignal,
        revise,
        mutate,
        announce: (message) => dispatch({ type: "announce", message }),
        captureSnapshot,
      }),
    [captureSnapshot, currentSignal, dispatch, dom, mutate, protocol, revise, stateRef],
  );

  useEffect(() => {
    selectionCapture.reconcile(new Set(stateRef.current.selections.map(({ id }) => id)));
  });

  useEffect(() => {
    // Pending images at mount belong to capture jobs from the previous view.
    for (const selection of stateRef.current.selections) {
      if (
        selection.snapshot.status === "pending" &&
        targetBelongsToDocument(selection.target, dom.document)
      ) {
        selectionCapture.settleUnavailable(
          selection.id,
          "Image capture was interrupted when the Lens view closed.",
        );
      }
    }
    return () => selectionCapture.dispose();
  }, [dom, selectionCapture, stateRef]);

  // A pending image whose target this document no longer shows cannot arrive,
  // so the kernel stops waiting for it.
  useEffect(() => {
    for (const selection of selections) {
      if (
        selection.snapshot.status === "pending" &&
        targetBelongsToDocument(selection.target, dom.document) &&
        !availableSelectionIds.has(selection.id)
      ) {
        selectionCapture.settleUnavailable(selection.id);
      }
    }
  }, [availableSelectionIds, dom, selectionCapture, selections]);

  const invalidateSnapshotCapture = useCallback(
    (selectionId: string) => selectionCapture.invalidate(selectionId),
    [selectionCapture],
  );

  /** Capture fresh pixels for a selection the state now holds. */
  const recapture = useCallback(
    (
      selection: Selection,
      output: HTMLElement,
      detail: Element,
      job: SelectionCaptureJob = selectionCapture.reserve(selection.id),
    ) => {
      const signal = currentSignal();
      void selectionCapture.capture(selection, output, detail, job).catch((cause: unknown) => {
        if (signal.aborted || isAbortCause(cause)) return;
        dispatch({ type: "announce", message: errorMessage(cause, "Snapshot capture failed") });
      });
    },
    [currentSignal, dispatch, selectionCapture],
  );

  const beginSelection = useCallback(
    (
      target: SelectionTarget,
      output: HTMLElement,
      anchor: SelectionAnchor,
      detailElement: Element,
      motion: SelectionMotion = "animate",
    ) => {
      currentSignal().throwIfAborted();
      const selection: Selection = {
        id: createSelectionId(dom.window),
        label: stateRef.current.nextLabel,
        note: "",
        target,
        createdAt: new dom.window.Date().toISOString(),
        anchor,
        domHint: collectDomHint(detailElement, output),
        description: targetInfo({ target, element: output }),
        snapshot: { status: "pending" },
      };
      const captureJob = selectionCapture.reserve(selection.id);
      dispatch({ type: "selectionQueued", selection, motion });
      let saved: Selection | undefined;
      mutate({
        run: (state) =>
          state.selections.some(({ id }) => id === selection.id)
            ? Promise.resolve({ revision: state.revision })
            : protocol.putSelection(
                { ...selection, label: state.nextLabel },
                "clear",
                state.revision,
              ),
        until: (latest) => {
          saved = latest.selections.find(({ id }) => id === selection.id);
          return saved !== undefined;
        },
        done: () => {
          dispatch({
            type: "selectionSettled",
            selectionId: selection.id,
            announcement: `${saved!.label} selected.`,
          });
          if (!stateRef.current.selections.some(({ id }) => id === selection.id)) {
            selectionCapture.release(selection.id, captureJob);
            return;
          }
          focusSelectionOrDock(dom, selection.id);
          if (selectionCapture.isActive(selection.id, captureJob)) {
            recapture(saved!, output, detailElement, captureJob);
          }
        },
        failed: "Selection could not be created",
        onFailure: (announcement) => {
          selectionCapture.release(selection.id, captureJob);
          dispatch({ type: "selectionSettled", selectionId: selection.id, announcement });
          focusDock(dom);
        },
      });
    },
    [currentSignal, dispatch, dom, mutate, protocol, recapture, selectionCapture, stateRef],
  );

  const activateSelection = useCallback(
    (selectionId: string) => {
      mutate({
        run: (state) =>
          state.currentSelectionId === selectionId
            ? Promise.resolve({ revision: state.revision })
            : protocol.activateSelection(selectionId, state.revision),
        until: (latest) => latest.currentSelectionId === selectionId,
        done: () => dispatch({ type: "activationSettled", selectionId }),
        failed: "Selection could not be activated",
        onFailure: (failure) => dispatch({ type: "activationSettled", selectionId, failure }),
      });
      dispatch({ type: "selectionActivated", selectionId });
    },
    [dispatch, mutate, protocol],
  );

  const openNote = useCallback(
    (selectionId: string, motion: SelectionMotion = "animate") => {
      activateSelection(selectionId);
      dispatch({ type: "editNote", selectionId, motion });
    },
    [activateSelection, dispatch],
  );

  const saveNote = useCallback(
    (selectionId: string, note: string) => {
      let label = "Selection";
      mutate({
        busyId: selectionId,
        run: (state) => {
          const current = requireSelection(state, selectionId);
          label = current.label;
          return protocol.putSelection({ ...current, note }, "preserve", state.revision);
        },
        until: (latest) =>
          latest.selections.some(
            (selection) => selection.id === selectionId && selection.note === note,
          ),
        done: () => {
          dispatch({ type: "noteSaveSucceeded", selectionId, label });
          focusSelectionOrDock(dom, selectionId);
        },
        failed: "Note could not be updated",
        onFailure: (message) => dispatch({ type: "noteSaveFailed", selectionId, message }),
      });
    },
    [dispatch, dom, mutate, protocol],
  );

  const deleteSelection = useCallback(
    (selection: Selection) => {
      // Focus moves to the selection beside the removed one, so removing
      // several in a row keeps the person in the list.
      const open = stateRef.current.selections;
      const index = open.findIndex(({ id }) => id === selection.id);
      const neighbor = open[index + 1] ?? open[index - 1];
      mutate({
        busyId: selection.id,
        run: (state) =>
          state.selections.some(({ id }) => id === selection.id)
            ? protocol.deleteSelection(selection.id, state.revision)
            : Promise.resolve({ revision: state.revision }),
        until: (latest) => !latest.selections.some(({ id }) => id === selection.id),
        done: () => {
          invalidateSnapshotCapture(selection.id);
          dispatch({ type: "announce", message: `${selection.label} removed.` });
          if (neighbor && stateRef.current.selections.some(({ id }) => id === neighbor.id)) {
            focusSelectionOrDock(dom, neighbor.id);
          } else {
            focusDock(dom);
          }
        },
        failed: "Selection could not be removed",
      });
    },
    [dispatch, dom, invalidateSnapshotCapture, mutate, protocol, stateRef],
  );

  const clearSelections = useCallback(() => {
    let clearedSelectionIds: string[] = [];
    let cleared = false;
    mutate({
      run: (state) => {
        clearedSelectionIds = state.selections.map(({ id }) => id);
        return state.selections.length === 0
          ? Promise.resolve({ revision: state.revision })
          : protocol.clearSelections(state.revision);
      },
      until: (latest) => latest.selections.length === 0,
      done: () => {
        for (const selectionId of clearedSelectionIds) invalidateSnapshotCapture(selectionId);
        cleared = true;
        dispatch({ type: "closeNote" });
        dispatch({ type: "setSheetOpen", open: false });
        dispatch({ type: "announce", message: "Selections cleared." });
      },
      failed: "Selections could not be cleared",
      settled: () => {
        dispatch({ type: "setClearPending", pending: false });
        if (cleared) focusDock(dom);
      },
    });
    dispatch({ type: "setClearPending", pending: true });
  }, [dispatch, dom, invalidateSnapshotCapture, mutate, protocol]);

  const reopenSelection = useCallback(
    (entry: HistoryEntry) => {
      mutate({
        busyId: entry.id,
        run: (state) => {
          const existing = state.selections.find(({ id }) => id === entry.id);
          return existing && selectionMatchesEntry(existing, entry)
            ? Promise.resolve({ revision: state.revision })
            : protocol.reopenSelection({
                selectionId: entry.id,
                resolvedAt: entry.resolvedAt,
                documentId: documentIdentity(dom.document),
                documentPath: dom.document.location?.pathname || "/",
                expectedRevision: state.revision,
              });
        },
        until: (latest) => {
          const reopened = latest.selections.find(({ id }) => id === entry.id);
          return (
            latest.currentSelectionId === entry.id &&
            reopened !== undefined &&
            selectionMatchesEntry(reopened, entry)
          );
        },
        done: () => {
          const reopened = requireSelection(stateRef.current, entry.id);
          dispatch({ type: "historyReopened", label: reopened.label });
          const output = dom.getTarget(reopened.target)?.element;
          if (output) {
            revealSelection(dom, reopened, "smooth");
            recapture(reopened, output, detailElement(dom, reopened.anchor, output));
          } else {
            dispatch({
              type: "announce",
              message: `${reopened.label} reopened. Target unavailable.`,
            });
          }
          focusSelectionOrDock(dom, reopened.id);
        },
        failed: "Selection could not be reopened",
      });
    },
    [dispatch, dom, mutate, protocol, recapture, stateRef],
  );

  const repositionSelection = useCallback(
    (selection: Selection, anchor: SelectionAnchor) => {
      currentSignal().throwIfAborted();
      const output = dom.getTarget(selection.target)?.element;
      if (!output) {
        dispatch({ type: "announce", message: "Target unavailable." });
        return;
      }
      const detail = detailElement(dom, anchor, output);
      const domHint = collectDomHint(detail, output);
      mutate({
        busyId: selection.id,
        run: (state) => {
          const current = requireSelection(state, selection.id);
          const prior = current.snapshot;
          const snapshot: Selection["snapshot"] =
            prior.status === "available"
              ? { ...prior, status: "outdated" }
              : prior.status === "outdated"
                ? prior
                : { status: "pending" };
          return protocol.putSelection(
            { ...current, anchor, domHint, snapshot },
            prior.status === "available" || prior.status === "outdated" ? "preserve" : "clear",
            state.revision,
          );
        },
        until: (latest) =>
          latest.selections.some(
            (candidate) => candidate.id === selection.id && sameAnchor(candidate.anchor, anchor),
          ),
        done: () => {
          const saved = stateRef.current.selections.find(({ id }) => id === selection.id);
          if (!saved) return;
          const job = selectionCapture.reserve(selection.id);
          dispatch({ type: "announce", message: `${saved.label} adjusted.` });
          recapture(saved, output, detail, job);
        },
        failed: "Selection could not be adjusted",
      });
    },
    [currentSignal, dispatch, dom, mutate, protocol, recapture, selectionCapture, stateRef],
  );

  return {
    beginSelection,
    activateSelection,
    openNote,
    saveNote,
    deleteSelection,
    clearSelections,
    reopenSelection,
    repositionSelection,
    invalidateSnapshotCapture,
  };
}

/** The element under an anchor's center, which describes the selection. */
function detailElement(dom: NotebookDomAdapter, anchor: SelectionAnchor, output: HTMLElement) {
  const point = anchorCenter(output, anchor);
  return dom.deepestElementAtPoint(point.x, point.y) ?? output;
}

function selectionMatchesEntry(selection: Selection, entry: HistoryEntry): boolean {
  const previous = selection.previousResolution;
  return (
    previous?.resolvedAt === entry.resolvedAt &&
    (previous.summary ?? undefined) === (entry.summary ?? undefined)
  );
}

function createSelectionId(ownerWindow: Window & typeof globalThis): string {
  return (
    ownerWindow.crypto.randomUUID?.() ??
    `selection-${ownerWindow.Date.now().toString(36)}-${ownerWindow.Math.random().toString(36).slice(2, 10)}`
  );
}

function requireSelection(state: LensState, selectionId: string): Selection {
  const selection = state.selections.find((candidate) => candidate.id === selectionId);
  if (!selection) throw new Error("Selection is no longer available");
  return selection;
}
