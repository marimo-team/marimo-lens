import type { LensState } from "@marimo-lens/protocol";

import { isAbortCause } from "@marimo-lens/protocol";
import { useCallback, useLayoutEffect, useRef, type Dispatch, type RefObject } from "react";

import type { UiAction } from "@/selection/state";

import { LensProtocolError } from "@/anywidget/client";
import { errorMessage } from "@/anywidget/error";

import { waitForRevision } from "./conflict";

/**
 * One Lens state change. `run` sends it against the current state, or returns
 * that state's revision when there is nothing to send. The change holds once
 * the state satisfies `until`, and then `done` runs before the next change.
 */
export type Revision = {
  run: (state: LensState) => Promise<{ revision: number }>;
  until: (state: LensState) => boolean;
  done?: () => void | Promise<void>;
};

/** A revision the person asked for, which announces its own failure. */
export type Mutation = Revision & {
  /** The selection the mutation marks busy until it settles. */
  busyId?: string;
  /** The announcement for a failure that carries no message. */
  failed: string;
  /** Report the failure message instead of announcing it. */
  onFailure?: (message: string) => void;
  /** Runs once the mutation succeeded or failed, unless the view closed. */
  settled?: () => void;
};

/**
 * Apply Lens state changes one at a time, each against the latest revision.
 * A change that times out or meets a revision conflict holds if the next state
 * satisfies it, and a conflict is retried once.
 */
export function useRevisionedMutations(
  stateRef: RefObject<LensState>,
  ownerWindow: Window & typeof globalThis,
  dispatch: Dispatch<UiAction>,
) {
  const currentSignal = useLifecycleSignal(ownerWindow);
  const tail = useRef<Promise<void> | null>(null);

  const enqueue = useCallback((change: () => Promise<void>): Promise<void> => {
    const result = (tail.current ?? Promise.resolve()).then(change, change);
    tail.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const settle = useCallback(
    async ({ run, until }: Revision): Promise<void> => {
      const signal = currentSignal();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        signal.throwIfAborted();
        const baseRevision = stateRef.current.revision;
        try {
          const response = await run(stateRef.current);
          await waitForRevision(ownerWindow, stateRef, response.revision, signal);
          signal.throwIfAborted();
          if (!until(stateRef.current)) {
            throw new Error("Lens state did not reflect the completed selection update");
          }
          return;
        } catch (error) {
          if (signal.aborted || isAbortCause(error)) throw error;
          if (error instanceof LensProtocolError && error.code === "timeout") {
            try {
              await waitForRevision(ownerWindow, stateRef, baseRevision + 1, signal);
              if (until(stateRef.current)) return;
            } catch (syncError) {
              if (signal.aborted || isAbortCause(syncError)) throw syncError;
            }
          }
          if (
            error instanceof LensProtocolError &&
            error.code === "revision_conflict" &&
            attempt === 0
          ) {
            await waitForRevision(
              ownerWindow,
              stateRef,
              error.revision ?? baseRevision + 1,
              signal,
            );
            if (until(stateRef.current)) return;
            continue;
          }
          throw error;
        }
      }
    },
    [currentSignal, ownerWindow, stateRef],
  );

  /** Queue `revision` and settle with it, rejecting when it fails. */
  const revise = useCallback(
    (revision: Revision): Promise<void> =>
      enqueue(async () => {
        await settle(revision);
        await revision.done?.();
      }),
    [enqueue, settle],
  );

  /** Queue `mutation` and announce its failure, unless the view closed. */
  const mutate = useCallback(
    ({ busyId, failed, onFailure, settled, ...revision }: Mutation): void => {
      const signal = currentSignal();
      signal.throwIfAborted();
      if (busyId) dispatch({ type: "mutationStarted", selectionId: busyId });
      void enqueue(async () => {
        try {
          await settle(revision);
          await revision.done?.();
        } catch (cause) {
          if (signal.aborted || isAbortCause(cause)) return;
          const message = errorMessage(cause, failed);
          if (onFailure) onFailure(message);
          else dispatch({ type: "announce", message });
        } finally {
          if (!signal.aborted) {
            if (busyId) dispatch({ type: "mutationFinished", selectionId: busyId });
            settled?.();
          }
        }
      });
    },
    [currentSignal, dispatch, enqueue, settle],
  );

  return { currentSignal, revise, mutate };
}

/**
 * Return the signal of the view's current mount. Mounting creates it before
 * any committed event can ask for it, and unmounting aborts it, so a late
 * caller gets an aborted signal.
 */
function useLifecycleSignal(ownerWindow: Window & typeof globalThis): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    const active = new ownerWindow.AbortController();
    controller.current = active;
    return () => active.abort();
  }, [ownerWindow]);

  return useCallback(() => {
    if (controller.current === null) {
      throw new ownerWindow.DOMException("Lens is inactive", "AbortError");
    }
    return controller.current.signal;
  }, [ownerWindow]);
}
