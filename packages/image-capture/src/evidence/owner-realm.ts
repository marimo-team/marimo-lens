import { isAbortCause, parseErrorCause } from "@marimo-lens/protocol";

export type OwnerWindow = Window & typeof globalThis;

export function ownerWindow(ownerDocument: Document): OwnerWindow {
  const window = ownerDocument.defaultView;
  if (!window) throw new Error("Output document is unavailable");
  return window;
}

export function ownerError(ownerDocument: Document, message: string): Error {
  return new (ownerWindow(ownerDocument).Error)(message);
}

export function throwIfCaptureAborted(
  signal: AbortSignal | undefined,
  ownerDocument: Document,
): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  const window = ownerWindow(ownerDocument);
  const message = parseErrorCause(reason)?.message || "Lens capture was canceled";
  throw new window.DOMException(message, "AbortError");
}

export function isCaptureAbort(cause: unknown): boolean {
  return isAbortCause(cause);
}
