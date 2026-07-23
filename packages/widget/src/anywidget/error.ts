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
