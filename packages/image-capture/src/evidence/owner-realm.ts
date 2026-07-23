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
  const message =
    typeof reason === "object" &&
    reason !== null &&
    "message" in reason &&
    typeof reason.message === "string" &&
    reason.message
      ? reason.message
      : "Lens capture was canceled";
  throw new (ownerWindow(ownerDocument).DOMException)(message, "AbortError");
}

export function isCaptureAbort(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}
