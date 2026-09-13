import type {
  AddressedSelection,
  LensState,
  Selection,
  SelectionAnchor,
  SelectionTarget,
  TargetSelector,
} from "@marimo-lens/protocol";

import { isAbortCause, parseErrorCause } from "@marimo-lens/protocol";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
} from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { SelectionSnapshotCapture } from "@/selection/selection-capture";
import type { SelectionMotion, UiAction } from "@/selection/state";

import { LensProtocolError } from "@/anywidget/client";
import { targetInfo } from "@/notebook/target-info";
import { anchorToViewport } from "@/selection/anchor";
import { waitForRevision } from "@/selection/conflict";
import { collectDomHint } from "@/selection/dom-hint";
import { revealSelection } from "@/selection/reveal";
import { SelectionCapture } from "@/selection/selection-capture";
import { focusDock, focusSelectionOrDock } from "@/ui/focus";

type RevisionedResult = { revision: number };
type RevisionedMutation = (state: LensState) => Promise<RevisionedResult>;

export function useSelectionActions(options: {
  stateRef: RefObject<LensState>;
  dispatch: Dispatch<UiAction>;
  dom: NotebookDomAdapter;
  selector: TargetSelector;
  protocol: LensProtocolClient;
  captureSnapshot?: SelectionSnapshotCapture;
}) {
  const { stateRef, dispatch, dom, selector, protocol, captureSnapshot } = options;
  const currentSignal = useLifecycleSignal(dom.window);
  const [mutationQueue] = useState(() => ({ tail: Promise.resolve() }));

  const enqueueMutation = useCallback(
    <T>(mutation: () => Promise<T>): Promise<T> => {
      const result = mutationQueue.tail.then(mutation, mutation);
      mutationQueue.tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [mutationQueue],
  );

  const runRevisioned = useCallback(
    async (
      mutation: RevisionedMutation,
      postcondition: (state: LensState) => boolean,
    ): Promise<void> => {
      const signal = currentSignal();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        signal.throwIfAborted();
        const baseRevision = stateRef.current.revision;
        try {
          const response = await mutation(stateRef.current);
          await waitForRevision(dom.window, stateRef, response.revision, signal);
          signal.throwIfAborted();
          if (!postcondition(stateRef.current)) {
            throw new Error("Lens state did not reflect the completed selection update");
          }
          return;
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) throw error;
          if (error instanceof LensProtocolError && error.code === "timeout") {
            try {
              await waitForRevision(dom.window, stateRef, baseRevision + 1, signal);
              if (postcondition(stateRef.current)) return;
            } catch (syncError) {
              if (signal.aborted || isAbortCause(syncError)) throw syncError;
            }
          }
          if (
            error instanceof LensProtocolError &&
            error.code === "revision_conflict" &&
            attempt === 0
          ) {
            await waitForRevision(dom.window, stateRef, error.revision ?? baseRevision + 1, signal);
            if (postcondition(stateRef.current)) return;
            continue;
          }
          throw error;
        }
      }
    },
    [currentSignal, dom, stateRef],
  );

  const selectionCapture = useMemo(
    () =>
      new SelectionCapture({
        stateRef,
        dom,
        selector,
        protocol,
        currentSignal,
        enqueueMutation,
        runRevisioned,
        announce: (message) => dispatch({ type: "announce", message }),
        captureSnapshot,
      }),
    [
      captureSnapshot,
      currentSignal,
      dispatch,
      dom,
      enqueueMutation,
      protocol,
      runRevisioned,
      stateRef,
      selector,
    ],
  );

  useEffect(() => {
    selectionCapture.reconcile(new Set(stateRef.current.selections.map(({ id }) => id)));
  });

  useEffect(() => () => selectionCapture.dispose(), [selectionCapture]);

  const invalidateSnapshotCapture = useCallback(
    (selectionId: string) => selectionCapture.invalidate(selectionId),
    [selectionCapture],
  );
  const settleUnavailableSnapshot = useCallback(
    (selectionId: string) => selectionCapture.settleUnavailable(selectionId),
    [selectionCapture],
  );

  const beginSelection = useCallback(
    (
      target: SelectionTarget,
      output: HTMLElement,
      anchor: SelectionAnchor,
      detailElement: Element,
      motion: SelectionMotion = "animate",
    ) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      const selection: Selection = {
        id: createSelectionId(dom.window),
        label: stateRef.current.nextLabel,
        note: "",
        target,
        createdAt: new dom.window.Date().toISOString(),
        anchor,
        domHint: collectDomHint(detailElement, output),
        description: targetInfo({ key: JSON.stringify(target), target, element: output }),
        snapshot: { status: "pending" },
      };
      const captureJob = selectionCapture.reserve(selection.id);
      dispatch({ type: "selectionQueued", pending: { selection }, motion });

      const committed = enqueueMutation(async () => {
        let committedSelection: Selection | null = null;
        await runRevisioned(
          async (state) => {
            const existing = state.selections.find((candidate) => candidate.id === selection.id);
            if (existing) {
              committedSelection = existing;
              return localResponse(state.revision);
            }
            const canonical = { ...selection, label: state.nextLabel };
            return protocol.putSelection(canonical, "clear", state.revision);
          },
          (latest) => {
            committedSelection =
              latest.selections.find((candidate) => candidate.id === selection.id) ?? null;
            return committedSelection !== null;
          },
        );
        if (!committedSelection) {
          committedSelection =
            stateRef.current.selections.find((candidate) => candidate.id === selection.id) ?? null;
        }
        if (!committedSelection) throw new Error("Selection was not committed");
        return committedSelection;
      });

      void committed
        .then((saved) => {
          if (signal.aborted) return;
          if (!stateRef.current.selections.some(({ id }) => id === saved.id)) {
            selectionCapture.release(saved.id, captureJob);
            return;
          }
          dispatch({ type: "selectionCommitted", selectionId: saved.id, label: saved.label });
          focusSelectionOrDock(dom, saved.id);
          if (!selectionCapture.isActive(saved.id, captureJob)) return;
          void selectionCapture
            .capture(saved, output, detailElement, captureJob)
            .catch((cause: unknown) => {
              if (signal.aborted || isAbortCause(cause)) return;
              dispatch({
                type: "announce",
                message: errorMessage(cause, "Snapshot capture failed"),
              });
            });
        })
        .catch((cause: unknown) => {
          selectionCapture.release(selection.id, captureJob);
          if (signal.aborted || isAbortCause(cause)) return;
          dispatch({
            type: "selectionFailed",
            selectionId: selection.id,
            message: errorMessage(cause, "Selection could not be created"),
          });
          focusDock(dom);
        });
    },
    [
      currentSignal,
      dispatch,
      dom,
      enqueueMutation,
      protocol,
      runRevisioned,
      selectionCapture,
      stateRef,
    ],
  );

  const activateSelection = useCallback(
    (selectionId: string) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      dispatch({ type: "selectionActivated", selectionId });
      void enqueueMutation(async () => {
        try {
          await runRevisioned(
            (state) =>
              state.currentSelectionId === selectionId
                ? Promise.resolve(localResponse(state.revision))
                : protocol.activateSelection(selectionId, state.revision),
            (latest) => latest.currentSelectionId === selectionId,
          );
          dispatch({ type: "activationCommitted", selectionId });
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) return;
          dispatch({
            type: "activationFailed",
            selectionId,
            message: errorMessage(error, "Selection could not be activated"),
          });
        }
      });
    },
    [currentSignal, dispatch, enqueueMutation, protocol, runRevisioned],
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
      const signal = currentSignal();
      signal.throwIfAborted();
      dispatch({ type: "noteSaveStarted", selectionId });
      void enqueueMutation(async () => {
        try {
          let label = "Selection";
          await runRevisioned(
            async (state) => {
              const current = requireSelection(state, selectionId);
              label = current.label;
              return protocol.putSelection({ ...current, note }, "preserve", state.revision);
            },
            (latest) =>
              latest.selections.some(
                (selection) => selection.id === selectionId && selection.note === note,
              ),
          );
          dispatch({ type: "noteSaveSucceeded", selectionId, label });
          focusSelectionOrDock(dom, selectionId);
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) return;
          dispatch({
            type: "noteSaveFailed",
            selectionId,
            message: errorMessage(error, "Note could not be updated"),
          });
        }
      });
    },
    [currentSignal, dispatch, dom, enqueueMutation, protocol, runRevisioned],
  );

  const deleteSelection = useCallback(
    (selection: Selection) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      dispatch({ type: "mutationStarted", selectionId: selection.id });
      void enqueueMutation(async () => {
        try {
          await runRevisioned(
            (state) =>
              state.selections.some((candidate) => candidate.id === selection.id)
                ? protocol.deleteSelection(selection.id, state.revision)
                : Promise.resolve(localResponse(state.revision)),
            (latest) => !latest.selections.some((candidate) => candidate.id === selection.id),
          );
          invalidateSnapshotCapture(selection.id);
          dispatch({ type: "setListOpen", open: false });
          dispatch({ type: "announce", message: `${selection.label} removed.` });
          focusDock(dom);
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) return;
          dispatch({
            type: "announce",
            message: errorMessage(error, "Selection could not be removed"),
          });
        } finally {
          if (!signal.aborted) dispatch({ type: "mutationFinished", selectionId: selection.id });
        }
      });
    },
    [
      currentSignal,
      dispatch,
      dom,
      enqueueMutation,
      invalidateSnapshotCapture,
      protocol,
      runRevisioned,
    ],
  );

  const clearSelections = useCallback(() => {
    const signal = currentSignal();
    signal.throwIfAborted();
    dispatch({ type: "clearStarted" });
    void enqueueMutation(async () => {
      let cleared = false;
      let clearedSelectionIds: string[] = [];
      try {
        await runRevisioned(
          (state) => {
            clearedSelectionIds = state.selections.map(({ id }) => id);
            return state.selections.length === 0
              ? Promise.resolve(localResponse(state.revision))
              : protocol.clearSelections(state.revision);
          },
          (latest) => latest.selections.length === 0,
        );
        for (const selectionId of clearedSelectionIds) {
          invalidateSnapshotCapture(selectionId);
        }
        cleared = true;
        dispatch({ type: "closeNote" });
        dispatch({ type: "setListOpen", open: false });
        dispatch({ type: "announce", message: "Selections cleared." });
      } catch (error) {
        if (signal.aborted || isAbortCause(error)) return;
        dispatch({
          type: "announce",
          message: errorMessage(error, "Selections could not be cleared"),
        });
      } finally {
        if (!signal.aborted) {
          dispatch({ type: "clearFinished" });
          if (cleared) focusDock(dom);
        }
      }
    });
  }, [
    currentSignal,
    dispatch,
    dom,
    enqueueMutation,
    invalidateSnapshotCapture,
    protocol,
    runRevisioned,
  ]);

  const reopenSelection = useCallback(
    (receipt: AddressedSelection) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      dispatch({ type: "mutationStarted", selectionId: receipt.selectionId });
      void enqueueMutation(async () => {
        try {
          await runRevisioned(
            (state) => {
              const existing = state.selections.find(
                (candidate) => candidate.id === receipt.selectionId,
              );
              return existing && selectionMatchesReceipt(existing, receipt)
                ? Promise.resolve(localResponse(state.revision))
                : protocol.reopenSelection(
                    receipt.selectionId,
                    receipt.resolutionRevision,
                    state.revision,
                  );
            },
            (latest) => {
              const reopened = latest.selections.find(
                (candidate) => candidate.id === receipt.selectionId,
              );
              return (
                latest.currentSelectionId === receipt.selectionId &&
                reopened !== undefined &&
                selectionMatchesReceipt(reopened, receipt)
              );
            },
          );
          const reopened = requireSelection(stateRef.current, receipt.selectionId);
          dispatch({
            type: "historyReopened",
            selectionId: reopened.id,
            label: reopened.label,
          });
          const output = dom.getTarget(reopened.target, selector)?.element;
          if (!output) {
            dispatch({
              type: "announce",
              message: `${reopened.label} reopened. Target unavailable.`,
            });
            focusSelectionOrDock(dom, reopened.id);
            return;
          }
          revealSelection(dom, reopened, "smooth", selector);
          const detail = detailElementForSelection(dom, reopened, output);
          const captureJob = selectionCapture.reserve(reopened.id);
          void selectionCapture
            .capture(reopened, output, detail, captureJob)
            .catch((cause: unknown) => {
              if (signal.aborted || isAbortCause(cause)) return;
              dispatch({
                type: "announce",
                message: errorMessage(cause, "Snapshot capture failed"),
              });
            });
          focusSelectionOrDock(dom, reopened.id);
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) return;
          dispatch({
            type: "announce",
            message: errorMessage(error, "Selection could not be reopened"),
          });
        } finally {
          if (!signal.aborted) {
            dispatch({ type: "mutationFinished", selectionId: receipt.selectionId });
          }
        }
      });
    },
    [
      currentSignal,
      dispatch,
      dom,
      enqueueMutation,
      protocol,
      runRevisioned,
      selectionCapture,
      stateRef,
      selector,
    ],
  );

  const clearHistory = useCallback(() => {
    const signal = currentSignal();
    signal.throwIfAborted();
    dispatch({ type: "historyClearStarted" });
    void enqueueMutation(async () => {
      try {
        await runRevisioned(
          (state) =>
            state.history.length === 0
              ? Promise.resolve(localResponse(state.revision))
              : protocol.clearHistory(state.revision),
          (latest) => latest.history.length === 0,
        );
        if (stateRef.current.selections.length > 0) {
          dispatch({ type: "setSheetTab", tab: "open" });
        } else {
          dispatch({ type: "setListOpen", open: false });
          focusDock(dom);
        }
        dispatch({ type: "announce", message: "History cleared." });
      } catch (error) {
        if (signal.aborted || isAbortCause(error)) return;
        dispatch({
          type: "announce",
          message: errorMessage(error, "History could not be cleared"),
        });
      } finally {
        if (!signal.aborted) dispatch({ type: "historyClearFinished" });
      }
    });
  }, [currentSignal, dispatch, dom, enqueueMutation, protocol, runRevisioned, stateRef]);

  const repositionSelection = useCallback(
    (selection: Selection, anchor: SelectionAnchor) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      const output = dom.getTarget(selection.target, selector)?.element;
      if (!output) {
        dispatch({ type: "announce", message: "Target unavailable." });
        return;
      }
      const detail = detailElementForAnchor(dom, anchor, output);
      const domHint = collectDomHint(detail, output);
      dispatch({ type: "mutationStarted", selectionId: selection.id });
      void enqueueMutation(async () => {
        try {
          await runRevisioned(
            async (state) => {
              const current = requireSelection(state, selection.id);
              const hasPriorImage =
                current.snapshot.status === "available" || current.snapshot.status === "outdated";
              const snapshot: Selection["snapshot"] =
                current.snapshot.status === "available"
                  ? { ...current.snapshot, status: "outdated" }
                  : current.snapshot.status === "outdated"
                    ? current.snapshot
                    : { status: "pending" };
              const next: Selection = { ...current, anchor, domHint, snapshot };
              return protocol.putSelection(
                next,
                hasPriorImage ? "preserve" : "clear",
                state.revision,
              );
            },
            (latest) =>
              latest.selections.some(
                (candidate) =>
                  candidate.id === selection.id && sameAnchor(candidate.anchor, anchor),
              ),
          );
          const saved = stateRef.current.selections.find(
            (candidate) => candidate.id === selection.id,
          );
          if (saved) {
            const captureJob = selectionCapture.reserve(selection.id);
            dispatch({ type: "announce", message: `${saved.label} adjusted.` });
            void selectionCapture
              .capture(saved, output, detail, captureJob)
              .catch((cause: unknown) => {
                if (signal.aborted || isAbortCause(cause)) return;
                dispatch({
                  type: "announce",
                  message: errorMessage(cause, "Snapshot capture failed"),
                });
              });
          }
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) return;
          dispatch({
            type: "announce",
            message: errorMessage(error, "Selection could not be adjusted"),
          });
        } finally {
          if (!signal.aborted) dispatch({ type: "mutationFinished", selectionId: selection.id });
        }
      });
    },
    [
      currentSignal,
      dispatch,
      dom,
      enqueueMutation,
      protocol,
      runRevisioned,
      selectionCapture,
      stateRef,
      selector,
    ],
  );

  return {
    beginSelection,
    activateSelection,
    openNote,
    saveNote,
    deleteSelection,
    clearSelections,
    reopenSelection,
    clearHistory,
    repositionSelection,
    invalidateSnapshotCapture,
    settleUnavailableSnapshot,
  };
}

function detailElementForSelection(
  dom: NotebookDomAdapter,
  selection: Selection,
  output: HTMLElement,
): Element {
  return detailElementForAnchor(dom, selection.anchor, output);
}

function detailElementForAnchor(
  dom: NotebookDomAdapter,
  anchor: SelectionAnchor,
  output: HTMLElement,
): Element {
  const center = anchorToViewport(output, anchor);
  const point =
    center.kind === "point"
      ? center
      : { x: center.x + center.width / 2, y: center.y + center.height / 2 };
  return dom.deepestElementAtPoint(point.x, point.y) ?? output;
}

function selectionMatchesReceipt(selection: Selection, receipt: AddressedSelection): boolean {
  const previous = selection.previousResolution;
  return (
    previous?.addressedAt === receipt.addressedAt &&
    (previous.summary ?? undefined) === (receipt.summary ?? undefined)
  );
}

function useLifecycleSignal(ownerWindow: Window & typeof globalThis): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  if (controller.current === null) controller.current = new ownerWindow.AbortController();

  useEffect(() => {
    if (controller.current?.signal.aborted) {
      controller.current = new ownerWindow.AbortController();
    }
    const active = controller.current;
    return () => active?.abort();
  }, [ownerWindow]);

  return useCallback(() => {
    if (controller.current === null) {
      throw new ownerWindow.DOMException("Lens is inactive", "AbortError");
    }
    return controller.current.signal;
  }, [ownerWindow]);
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

function localResponse(revision: number): RevisionedResult {
  return { revision };
}

function sameAnchor(left: SelectionAnchor, right: SelectionAnchor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(cause: unknown, fallback: string): string {
  return parseErrorCause(cause)?.message || fallback;
}
