import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject } from "react";

import type { ImageAction, LensResponse, LensState, Selection, SelectionAnchor } from "@/contracts";
import type { LensProtocolClient } from "@/protocol";
import type { SelectionMotion, UiAction } from "@/state";

import { anchorToViewport } from "@/capture/anchor";
import { collectDomHint } from "@/capture/dom-hint";
import { captureSelectionSnapshot } from "@/capture/image";
import { deepestElementAtPoint, getOutputCell } from "@/capture/output-root";
import { waitForRevision } from "@/conflict";
import { focusDock, focusSelectionOrDock } from "@/focus";
import { LensProtocolError } from "@/protocol";

type RevisionedMutation = (state: LensState) => Promise<LensResponse>;

export function useSelectionActions(options: {
  stateRef: RefObject<LensState>;
  dispatch: Dispatch<UiAction>;
  protocol: LensProtocolClient;
}) {
  const { stateRef, dispatch, protocol } = options;
  const currentSignal = useLifecycleSignal();
  const [mutationQueue] = useState(() => ({ tail: Promise.resolve() }));
  const [captureGeneration] = useState(() => new Map<string, symbol>());

  const reserveSnapshotCapture = useCallback(
    (selectionId: string): symbol => {
      const ticket = Symbol(selectionId);
      captureGeneration.set(selectionId, ticket);
      return ticket;
    },
    [captureGeneration],
  );

  const releaseSnapshotCapture = useCallback(
    (selectionId: string, generation: symbol) => {
      if (captureGeneration.get(selectionId) === generation) {
        captureGeneration.delete(selectionId);
      }
    },
    [captureGeneration],
  );

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
          await waitForRevision(stateRef, response.revision, signal);
          signal.throwIfAborted();
          if (!postcondition(stateRef.current)) {
            throw new Error("Lens state did not reflect the completed selection update");
          }
          return;
        } catch (error) {
          if (signal.aborted || isAbortError(error)) throw error;
          if (error instanceof LensProtocolError && error.code === "timeout") {
            try {
              await waitForRevision(stateRef, baseRevision + 1, signal);
              if (postcondition(stateRef.current)) return;
            } catch (syncError) {
              if (signal.aborted || isAbortError(syncError)) throw syncError;
            }
          }
          if (
            error instanceof LensProtocolError &&
            error.code === "revision_conflict" &&
            attempt === 0
          ) {
            await waitForRevision(stateRef, error.revision ?? baseRevision + 1, signal);
            if (postcondition(stateRef.current)) return;
            continue;
          }
          throw error;
        }
      }
    },
    [currentSignal, stateRef],
  );

  const commitSnapshot = useCallback(
    async (
      selectionId: string,
      anchor: SelectionAnchor,
      generation: symbol,
      result: Awaited<ReturnType<typeof captureSelectionSnapshot>>,
    ) => {
      const signal = currentSignal();
      if (captureGeneration.get(selectionId) !== generation) return;
      await enqueueMutation(async () => {
        if (captureGeneration.get(selectionId) !== generation) return;
        let retainedOutdated = false;
        const snapshot = result.status === "available" ? result.snapshot.metadata : result.snapshot;
        await runRevisioned(
          async (state) => {
            const current = state.selections.find((selection) => selection.id === selectionId);
            if (!current || !sameAnchor(current.anchor, anchor))
              return localResponse(state.revision);
            if (result.status === "failed" && current.snapshot.status === "outdated") {
              retainedOutdated = true;
              return localResponse(state.revision);
            }
            const imageAction: ImageAction = result.status === "available" ? "replace" : "clear";
            return protocol.putSelection(
              { ...current, snapshot },
              imageAction,
              state.revision,
              result.status === "available" ? result.snapshot.bytes : undefined,
            );
          },
          (latest) => {
            const current = latest.selections.find((selection) => selection.id === selectionId);
            return (
              !current ||
              !sameAnchor(current.anchor, anchor) ||
              (result.status === "failed" && current.snapshot.status === "outdated") ||
              sameSnapshot(current.snapshot, snapshot)
            );
          },
        );
        const current = stateRef.current.selections.find(
          (selection) => selection.id === selectionId,
        );
        if (
          !signal.aborted &&
          captureGeneration.get(selectionId) === generation &&
          current &&
          sameAnchor(current.anchor, anchor)
        ) {
          dispatch({
            type: "announce",
            message:
              result.status === "available"
                ? "Snapshot ready."
                : retainedOutdated
                  ? "Snapshot refresh failed. Previous snapshot retained."
                  : "Snapshot unavailable. Text context is ready.",
          });
        }
      });
    },
    [
      captureGeneration,
      currentSignal,
      dispatch,
      enqueueMutation,
      protocol,
      runRevisioned,
      stateRef,
    ],
  );

  const captureSnapshot = useCallback(
    async (
      selection: Selection,
      output: HTMLElement,
      detailElement: Element,
      generation: symbol,
    ) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      if (captureGeneration.get(selection.id) !== generation) return;
      const current = stateRef.current.selections.find(({ id }) => id === selection.id);
      if (!current || !sameAnchor(current.anchor, selection.anchor)) return;
      try {
        const result = await captureSelectionSnapshot({
          selectionId: selection.id,
          label: selection.label,
          anchor: selection.anchor,
          output,
          detailElement,
          signal,
        });
        signal.throwIfAborted();
        await commitSnapshot(selection.id, selection.anchor, generation, result);
      } catch (error) {
        if (captureGeneration.get(selection.id) !== generation) return;
        throw error;
      } finally {
        releaseSnapshotCapture(selection.id, generation);
      }
    },
    [captureGeneration, commitSnapshot, currentSignal, releaseSnapshotCapture, stateRef],
  );

  const invalidateSnapshotCapture = useCallback(
    (selectionId: string) => {
      captureGeneration.delete(selectionId);
    },
    [captureGeneration],
  );

  const beginSelection = useCallback(
    (
      outputCellId: string,
      output: HTMLElement,
      anchor: SelectionAnchor,
      detailElement: Element,
    ) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      const selection: Selection = {
        id: createSelectionId(),
        label: stateRef.current.nextLabel,
        note: "",
        outputCellId,
        createdAt: new Date().toISOString(),
        anchor,
        domHint: collectDomHint(detailElement, output),
        snapshot: { status: "pending" },
      };
      const captureTicket = reserveSnapshotCapture(selection.id);
      dispatch({ type: "selectionQueued", pending: { selection } });

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
          if (
            captureGeneration.get(saved.id) !== captureTicket ||
            !stateRef.current.selections.some(({ id }) => id === saved.id)
          ) {
            releaseSnapshotCapture(saved.id, captureTicket);
            return;
          }
          dispatch({ type: "selectionCommitted", selectionId: saved.id, label: saved.label });
          focusSelectionOrDock(saved.id);
          void captureSnapshot(saved, output, detailElement, captureTicket).catch(
            (error: unknown) => {
              if (signal.aborted || isAbortError(error)) return;
              dispatch({
                type: "announce",
                message: errorMessage(error, "Snapshot capture failed"),
              });
            },
          );
        })
        .catch((error: unknown) => {
          releaseSnapshotCapture(selection.id, captureTicket);
          if (signal.aborted || isAbortError(error)) return;
          dispatch({
            type: "selectionFailed",
            selectionId: selection.id,
            message: errorMessage(error, "Selection could not be created"),
          });
          focusDock();
        });
    },
    [
      captureGeneration,
      captureSnapshot,
      currentSignal,
      dispatch,
      enqueueMutation,
      protocol,
      releaseSnapshotCapture,
      reserveSnapshotCapture,
      runRevisioned,
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
          if (signal.aborted || isAbortError(error)) return;
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
          focusSelectionOrDock(selectionId);
        } catch (error) {
          if (signal.aborted || isAbortError(error)) return;
          dispatch({
            type: "noteSaveFailed",
            selectionId,
            message: errorMessage(error, "Note could not be updated"),
          });
        }
      });
    },
    [currentSignal, dispatch, enqueueMutation, protocol, runRevisioned],
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
          dispatch({ type: "closeNote" });
          dispatch({ type: "setListOpen", open: false });
          dispatch({ type: "announce", message: `${selection.label} removed.` });
          focusDock();
        } catch (error) {
          if (signal.aborted || isAbortError(error)) return;
          dispatch({
            type: "announce",
            message: errorMessage(error, "Selection could not be removed"),
          });
        } finally {
          if (!signal.aborted) dispatch({ type: "mutationFinished", selectionId: selection.id });
        }
      });
    },
    [currentSignal, dispatch, enqueueMutation, invalidateSnapshotCapture, protocol, runRevisioned],
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
        if (signal.aborted || isAbortError(error)) return;
        dispatch({
          type: "announce",
          message: errorMessage(error, "Selections could not be cleared"),
        });
      } finally {
        if (!signal.aborted) {
          dispatch({ type: "clearFinished" });
          if (cleared) focusDock();
        }
      }
    });
  }, [
    currentSignal,
    dispatch,
    enqueueMutation,
    invalidateSnapshotCapture,
    protocol,
    runRevisioned,
  ]);

  const refreshSnapshot = useCallback(
    (selection: Selection) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      const output = getOutputCell(selection.outputCellId)?.element;
      if (!output) {
        dispatch({ type: "announce", message: "Output unavailable." });
        return;
      }
      const center = anchorToViewport(output, selection.anchor);
      const point =
        center.kind === "point"
          ? center
          : { x: center.x + center.width / 2, y: center.y + center.height / 2 };
      const detail = deepestElementAtPoint(point.x, point.y) ?? output;
      const captureTicket = reserveSnapshotCapture(selection.id);
      dispatch({ type: "mutationStarted", selectionId: selection.id });
      void enqueueMutation(async () => {
        try {
          await runRevisioned(
            async (state) => {
              const current = requireSelection(state, selection.id);
              if (current.snapshot.status === "outdated") return localResponse(state.revision);
              const hasPriorImage = current.snapshot.status === "available";
              const snapshot: Selection["snapshot"] =
                current.snapshot.status === "available"
                  ? { ...current.snapshot, status: "outdated" }
                  : { status: "pending" };
              return protocol.putSelection(
                { ...current, snapshot },
                hasPriorImage ? "preserve" : "clear",
                state.revision,
              );
            },
            (latest) => {
              const current = latest.selections.find(({ id }) => id === selection.id);
              return (
                current?.snapshot.status === "outdated" || current?.snapshot.status === "pending"
              );
            },
          );
          const current = requireSelection(stateRef.current, selection.id);
          void captureSnapshot(current, output, detail, captureTicket).catch((error: unknown) => {
            if (signal.aborted || isAbortError(error)) return;
            dispatch({ type: "announce", message: errorMessage(error, "Snapshot capture failed") });
          });
        } catch (error) {
          releaseSnapshotCapture(selection.id, captureTicket);
          if (signal.aborted || isAbortError(error)) return;
          dispatch({
            type: "announce",
            message: errorMessage(error, "Snapshot could not be refreshed"),
          });
        } finally {
          if (!signal.aborted) dispatch({ type: "mutationFinished", selectionId: selection.id });
        }
      });
    },
    [
      captureSnapshot,
      currentSignal,
      dispatch,
      enqueueMutation,
      protocol,
      releaseSnapshotCapture,
      reserveSnapshotCapture,
      runRevisioned,
      stateRef,
    ],
  );

  const repositionSelection = useCallback(
    (selection: Selection, anchor: SelectionAnchor) => {
      const signal = currentSignal();
      signal.throwIfAborted();
      const output = getOutputCell(selection.outputCellId)?.element;
      if (!output) {
        dispatch({ type: "announce", message: "Output unavailable." });
        return;
      }
      const center = anchorToViewport(output, anchor);
      const point =
        center.kind === "point"
          ? center
          : { x: center.x + center.width / 2, y: center.y + center.height / 2 };
      const detail = deepestElementAtPoint(point.x, point.y) ?? output;
      const domHint = collectDomHint(detail, output);
      const captureTicket = reserveSnapshotCapture(selection.id);
      dispatch({ type: "mutationStarted", selectionId: selection.id });
      void enqueueMutation(async () => {
        try {
          let updated: Selection | null = null;
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
              updated = next;
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
          const saved =
            stateRef.current.selections.find((candidate) => candidate.id === selection.id) ??
            updated;
          if (saved) {
            dispatch({ type: "announce", message: `${saved.label} adjusted.` });
            void captureSnapshot(saved, output, detail, captureTicket).catch((error: unknown) => {
              if (signal.aborted || isAbortError(error)) return;
              dispatch({
                type: "announce",
                message: errorMessage(error, "Snapshot capture failed"),
              });
            });
          }
        } catch (error) {
          releaseSnapshotCapture(selection.id, captureTicket);
          if (signal.aborted || isAbortError(error)) return;
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
      captureSnapshot,
      currentSignal,
      dispatch,
      enqueueMutation,
      protocol,
      releaseSnapshotCapture,
      reserveSnapshotCapture,
      runRevisioned,
      stateRef,
    ],
  );

  return {
    beginSelection,
    activateSelection,
    openNote,
    saveNote,
    deleteSelection,
    clearSelections,
    refreshSnapshot,
    repositionSelection,
    invalidateSnapshotCapture,
  };
}

function useLifecycleSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  if (controller.current === null) controller.current = new AbortController();

  useEffect(() => {
    if (controller.current?.signal.aborted) controller.current = new AbortController();
    const active = controller.current;
    return () => active?.abort();
  }, []);

  return useCallback(() => {
    if (controller.current === null) throw new DOMException("Lens is inactive", "AbortError");
    return controller.current.signal;
  }, []);
}

function createSelectionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `selection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function requireSelection(state: LensState, selectionId: string): Selection {
  const selection = state.selections.find((candidate) => candidate.id === selectionId);
  if (!selection) throw new Error("Selection is no longer available");
  return selection;
}

function localResponse(revision: number): LensResponse {
  return {
    protocol: "marimo-lens.response",
    version: 1,
    requestId: "local",
    ok: true,
    revision,
    payload: {},
  };
}

function sameAnchor(left: SelectionAnchor, right: SelectionAnchor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSnapshot(left: Selection["snapshot"], right: Selection["snapshot"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
