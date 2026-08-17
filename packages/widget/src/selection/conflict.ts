import type { LensState } from "@marimo-lens/protocol";
import type { RefObject } from "react";

export class RevisionSyncTimeoutError extends Error {
  constructor(requiredRevision: number) {
    super(`Lens state did not reach revision ${requiredRevision}. Refresh and try again.`);
    this.name = "RevisionSyncTimeoutError";
  }
}

export function waitForRevision(
  ownerWindow: Window & typeof globalThis,
  stateRef: RefObject<LensState>,
  requiredRevision: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new ownerWindow.DOMException("Lens closed", "AbortError"),
    );
  }
  if (stateRef.current.revision >= requiredRevision) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = ownerWindow.Date.now();
    let timeout = 0;
    const finish = (cause?: unknown) => {
      ownerWindow.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (cause) reject(cause);
      else resolve();
    };
    const abort = () =>
      finish(signal.reason ?? new ownerWindow.DOMException("Lens closed", "AbortError"));
    const poll = () => {
      if (stateRef.current.revision >= requiredRevision) {
        finish();
      } else if (ownerWindow.Date.now() - started > 5_000) {
        finish(new RevisionSyncTimeoutError(requiredRevision));
      } else {
        timeout = ownerWindow.setTimeout(poll, 25);
      }
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    poll();
  });
}
