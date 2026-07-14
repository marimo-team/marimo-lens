import type { AnyModel } from "@anywidget/types";

import type {
  CommandPayload,
  CommandType,
  ImageAction,
  LensResponse,
  Selection,
} from "@/contracts";

import { LensCommandSchema, parseContract, parseLensResponse } from "@/contracts";

const RESPONSE_PROTOCOL = "marimo-lens.response";
const REQUEST_TIMEOUT_MS = 20_000;

type PendingRequest = {
  resolve: (response: LensResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
};

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

export class LensProtocolClient {
  readonly #model: AnyModel;
  readonly #pending = new Map<string, PendingRequest>();
  #started = false;

  constructor(model: AnyModel) {
    this.#model = model;
  }

  start(): void {
    if (this.#started) return;
    this.#model.on("msg:custom", this.#handleMessage);
    this.#started = true;
  }

  dispose(): void {
    if (this.#started) this.#model.off("msg:custom", this.#handleMessage);
    this.#started = false;
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(
        new LensProtocolError("client_disposed", "Lens closed before the request completed"),
      );
    }
    this.#pending.clear();
  }

  putSelection(
    selection: Selection,
    imageAction: ImageAction,
    expectedRevision: number,
    bytes?: Uint8Array,
  ): Promise<LensResponse> {
    if (imageAction === "replace" && !bytes) {
      return Promise.reject(
        new LensProtocolError("invalid_command", "Replacing a snapshot requires one PNG buffer"),
      );
    }
    if (imageAction !== "replace" && bytes) {
      return Promise.reject(
        new LensProtocolError("invalid_command", `${imageAction} cannot include a PNG buffer`),
      );
    }
    return this.request(
      "selection.put",
      { selection, imageAction, expectedRevision },
      bytes ? [exactArrayBuffer(bytes)] : [],
    );
  }

  activateSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.request("selection.activate", { selectionId, expectedRevision });
  }

  deleteSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.request("selection.delete", { selectionId, expectedRevision });
  }

  clearSelections(expectedRevision: number): Promise<LensResponse> {
    return this.request("selections.clear", { expectedRevision });
  }

  async exportContext(): Promise<string> {
    const response = await this.request("context.export", {});
    const context = response.payload.text;
    if (typeof context !== "string") {
      throw new LensProtocolError("invalid_response", "Context response is missing its text");
    }
    return context;
  }

  request<TType extends CommandType>(
    type: TType,
    payload: CommandPayload<TType>,
    buffers: ArrayBuffer[] = [],
  ): Promise<LensResponse> {
    if (!this.#started) {
      return Promise.reject(
        new LensProtocolError("client_disposed", "Lens is not connected to its widget model"),
      );
    }
    const requestId = createRequestId();
    const command = parseContract(
      LensCommandSchema,
      {
        protocol: "marimo-lens.command",
        version: 1,
        requestId,
        type,
        payload,
      },
      "Lens command",
    );

    return new Promise<LensResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new LensProtocolError("timeout", `Lens request ${type} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timeout });
      try {
        this.#model.send(command, undefined, buffers);
      } catch (error) {
        window.clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).then((response) => {
      if (!response.ok) {
        throw new LensProtocolError(response.error.code, response.error.message, response.revision);
      }
      return response;
    });
  }

  readonly #handleMessage = (message: unknown): void => {
    if (!isResponseMessage(message)) return;
    const requestId = typeof message.requestId === "string" ? message.requestId : null;
    if (!requestId) return;
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    let response: LensResponse;
    try {
      response = parseLensResponse(message);
    } catch (error) {
      window.clearTimeout(pending.timeout);
      this.#pending.delete(requestId);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    window.clearTimeout(pending.timeout);
    this.#pending.delete(requestId);
    pending.resolve(response);
  };
}

function isResponseMessage(message: unknown): message is { protocol: string; requestId?: unknown } {
  return (
    typeof message === "object" &&
    message !== null &&
    "protocol" in message &&
    message.protocol === RESPONSE_PROTOCOL
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
