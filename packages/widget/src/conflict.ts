import type { RefObject } from "react";

import type { LensState } from "@/contracts";

export class RevisionSyncTimeoutError extends Error {
  constructor(requiredRevision: number) {
    super(`Lens state did not reach revision ${requiredRevision}. Refresh and try again.`);
    this.name = "RevisionSyncTimeoutError";
  }
}

export function waitForRevision(
  stateRef: RefObject<LensState>,
  requiredRevision: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Lens closed", "AbortError"));
  }
  if (stateRef.current.revision >= requiredRevision) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let timeout = 0;
    const finish = (error?: unknown) => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason ?? new DOMException("Lens closed", "AbortError"));
    const poll = () => {
      if (stateRef.current.revision >= requiredRevision) {
        finish();
      } else if (Date.now() - started > 5_000) {
        finish(new RevisionSyncTimeoutError(requiredRevision));
      } else {
        timeout = window.setTimeout(poll, 25);
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
