import type { CaptureResult } from "@marimo-lens/image-capture";
import type { ImageAction, LensState, Selection, SelectionAnchor } from "@marimo-lens/protocol";

import { captureSelectionSnapshot } from "@marimo-lens/image-capture";
import { isAbortCause, parseErrorCause } from "@marimo-lens/protocol";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

type RevisionedResult = { revision: number };
type RevisionedMutation = (state: LensState) => Promise<RevisionedResult>;
type EnqueueMutation = <T>(mutation: () => Promise<T>) => Promise<T>;
type RunRevisioned = (
  mutation: RevisionedMutation,
  postcondition: (state: LensState) => boolean,
) => Promise<void>;

export type SelectionCaptureJob = {
  ticket: symbol;
  controller: AbortController;
  started: boolean;
};

export class SelectionCapture {
  readonly #stateRef: { current: LensState };
  readonly #dom: NotebookDomAdapter;
  readonly #protocol: LensProtocolClient;
  readonly #currentSignal: () => AbortSignal;
  readonly #enqueueMutation: EnqueueMutation;
  readonly #runRevisioned: RunRevisioned;
  readonly #announce: (message: string) => void;
  readonly #jobs = new Map<string, SelectionCaptureJob>();

  constructor(options: {
    stateRef: { current: LensState };
    dom: NotebookDomAdapter;
    protocol: LensProtocolClient;
    currentSignal: () => AbortSignal;
    enqueueMutation: EnqueueMutation;
    runRevisioned: RunRevisioned;
    announce: (message: string) => void;
  }) {
    this.#stateRef = options.stateRef;
    this.#dom = options.dom;
    this.#protocol = options.protocol;
    this.#currentSignal = options.currentSignal;
    this.#enqueueMutation = options.enqueueMutation;
    this.#runRevisioned = options.runRevisioned;
    this.#announce = options.announce;
  }

  reserve(selectionId: string): SelectionCaptureJob {
    this.invalidate(selectionId);
    const job = {
      ticket: Symbol(selectionId),
      controller: new this.#dom.window.AbortController(),
      started: false,
    };
    this.#jobs.set(selectionId, job);
    return job;
  }

  isActive(selectionId: string, job: SelectionCaptureJob): boolean {
    return this.#jobs.get(selectionId)?.ticket === job.ticket;
  }

  release(selectionId: string, job: SelectionCaptureJob): void {
    if (this.isActive(selectionId, job)) this.#jobs.delete(selectionId);
  }

  invalidate(selectionId: string): void {
    const job = this.#jobs.get(selectionId);
    if (!job) return;
    job.controller.abort();
    this.#jobs.delete(selectionId);
  }

  reconcile(selectionIds: ReadonlySet<string>): void {
    for (const [selectionId, job] of this.#jobs) {
      if (job.started && !selectionIds.has(selectionId)) this.invalidate(selectionId);
    }
  }

  settleUnavailable(selectionId: string): void {
    this.#settleFailed(selectionId, "The output changed before snapshot capture completed.");
  }

  #settleFailed(selectionId: string, error: string): void {
    this.invalidate(selectionId);
    const signal = this.#currentSignal();
    void this.#enqueueMutation(async () => {
      try {
        await this.#runRevisioned(
          (state) => {
            const current = state.selections.find((selection) => selection.id === selectionId);
            if (!current || current.snapshot.status !== "pending") {
              return Promise.resolve(localResponse(state.revision));
            }
            return this.#protocol.putSelection(
              { ...current, snapshot: this.#failedSnapshot(error) },
              "clear",
              state.revision,
            );
          },
          (latest) => {
            const current = latest.selections.find((selection) => selection.id === selectionId);
            return !current || current.snapshot.status !== "pending";
          },
        );
      } catch (error) {
        if (signal.aborted || isAbortCause(error)) return;
        this.#announce(errorMessage(error, "Snapshot capture could not be settled"));
      }
    });
  }

  async capture(
    selection: Selection,
    output: HTMLElement,
    detailElement: Element,
    job: SelectionCaptureJob,
  ): Promise<void> {
    const signal = job.controller.signal;
    try {
      signal.throwIfAborted();
      if (!this.isActive(selection.id, job)) return;
      const current = this.#stateRef.current.selections.find(({ id }) => id === selection.id);
      if (!current || !sameAnchor(current.anchor, selection.anchor)) return;
      job.started = true;
      const result = await captureSelectionSnapshot({
        selectionId: selection.id,
        label: selection.label,
        anchor: selection.anchor,
        output,
        detailElement,
        signal,
      });
      signal.throwIfAborted();
      await this.#commit(selection, output, job, result);
    } catch (error) {
      if (!this.isActive(selection.id, job)) return;
      if (!signal.aborted && !isAbortCause(error)) {
        this.#settleFailed(selection.id, "Snapshot capture did not complete.");
      }
      throw error;
    } finally {
      this.release(selection.id, job);
    }
  }

  dispose(): void {
    for (const job of this.#jobs.values()) job.controller.abort();
    this.#jobs.clear();
  }

  async #commit(
    selection: Selection,
    output: HTMLElement,
    job: SelectionCaptureJob,
    result: CaptureResult,
  ): Promise<void> {
    const lifecycleSignal = this.#currentSignal();
    const captureSignal = job.controller.signal;
    if (captureSignal.aborted || !this.isActive(selection.id, job)) return;
    await this.#enqueueMutation(async () => {
      if (captureSignal.aborted || !this.isActive(selection.id, job)) return;
      let retainedOutdated = false;
      let committedStatus = result.status;
      let committedSnapshot: Selection["snapshot"] | null = null;
      await this.#runRevisioned(
        async (state) => {
          const current = state.selections.find((candidate) => candidate.id === selection.id);
          if (
            !current ||
            current.outputCellId !== selection.outputCellId ||
            !sameAnchor(current.anchor, selection.anchor)
          ) {
            return localResponse(state.revision);
          }
          const currentResult = this.#isCanonicalOutput(selection.outputCellId, output)
            ? result
            : this.#failedCapture();
          committedStatus = currentResult.status;
          committedSnapshot =
            currentResult.status === "available"
              ? currentResult.snapshot.metadata
              : currentResult.snapshot;
          if (currentResult.status === "failed" && current.snapshot.status === "outdated") {
            retainedOutdated = true;
            return localResponse(state.revision);
          }
          const imageAction: ImageAction =
            currentResult.status === "available" ? "replace" : "clear";
          return this.#protocol.putSelection(
            { ...current, snapshot: committedSnapshot },
            imageAction,
            state.revision,
            currentResult.status === "available" ? currentResult.snapshot.bytes : undefined,
          );
        },
        (latest) => {
          const current = latest.selections.find((candidate) => candidate.id === selection.id);
          return (
            !current ||
            current.outputCellId !== selection.outputCellId ||
            !sameAnchor(current.anchor, selection.anchor) ||
            (committedStatus === "failed" && current.snapshot.status === "outdated") ||
            (committedSnapshot !== null && sameSnapshot(current.snapshot, committedSnapshot))
          );
        },
      );
      const current = this.#stateRef.current.selections.find(
        (candidate) => candidate.id === selection.id,
      );
      if (
        !lifecycleSignal.aborted &&
        !captureSignal.aborted &&
        this.isActive(selection.id, job) &&
        current &&
        sameAnchor(current.anchor, selection.anchor)
      ) {
        this.#announce(
          committedStatus === "available"
            ? "Image ready."
            : retainedOutdated
              ? "Previous image retained. Move or reselect to capture a new observation."
              : "Image unavailable. Text context is ready.",
        );
      }
    });
  }

  #isCanonicalOutput(outputCellId: string, output: HTMLElement): boolean {
    return output.isConnected && this.#dom.getOutputCell(outputCellId)?.element === output;
  }

  #failedCapture(): CaptureResult {
    return { status: "failed", snapshot: this.#failedSnapshot() };
  }

  #failedSnapshot(
    error = "The output changed before snapshot capture completed.",
  ): Extract<Selection["snapshot"], { status: "failed" }> {
    return {
      status: "failed",
      capturedAt: new this.#dom.window.Date().toISOString(),
      error,
    };
  }
}

function localResponse(revision: number): RevisionedResult {
  return { revision };
}

function sameAnchor(left: SelectionAnchor, right: SelectionAnchor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSnapshot(left: Selection["snapshot"], right: Selection["snapshot"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(cause: unknown, fallback: string): string {
  return parseErrorCause(cause)?.message || fallback;
}
