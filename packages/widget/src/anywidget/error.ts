import { parseErrorCause } from "@marimo-lens/protocol";

export class LensProtocolError extends Error {
  readonly code: string;
  readonly revision?: number;

  constructor(code: string, message: string, revision?: number) {
    super(message);
    this.name = "LensProtocolError";
    this.code = code;
    this.revision = revision;
  }
}

/** The message a failure carries, or `fallback` when it has none. */
export function errorMessage(cause: unknown, fallback: string): string {
  return parseErrorCause(cause)?.message || fallback;
}
