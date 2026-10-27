import type {
  AttentionEvent,
  ClientCommand,
  CommandPayload,
  CommandType,
  ImageAction,
  LensResponse,
  Selection,
  SelectionResolvedEvent,
  StoredSnapshot,
  TransportEnvelope,
  TransportValue,
} from "@marimo-lens/protocol";

import {
  ClientCommandSchema,
  HistoryImageResponsePayloadSchema,
  SnapshotResponsePayloadSchema,
  WIDGET_TRANSPORT_VERSION,
  parseAttentionEvent,
  parseContract,
  parseLensResponse,
  parseSelectionResolvedEvent,
  parseTransportEnvelope,
} from "@marimo-lens/protocol";

import type { LensWidgetModel, OutputCaptureHandler } from "@/anywidget/transport";

import { LensProtocolError } from "@/anywidget/error";
import { exactBytes, OutputCaptureTransport } from "@/anywidget/output-capture-transport";

export { LensProtocolError };

const REQUEST_TIMEOUT_MS = 20_000;

export type SnapshotAsset = {
  snapshot: StoredSnapshot;
  bytes: Uint8Array<ArrayBuffer>;
};

type Reply = { response: LensResponse; buffers: DataView[] };

type PendingRequest = {
  command: ClientCommand;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timeout: number;
};

export class LensProtocolClient {
  readonly #model: LensWidgetModel;
  readonly #window: Window;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #resolvedListeners = new Set<(event: SelectionResolvedEvent) => void>();
  readonly #attentionListeners = new Set<(event: AttentionEvent) => void>();
  readonly #captures: OutputCaptureTransport;
  #started = false;

  constructor(model: LensWidgetModel, ownerWindow: Window) {
    this.#model = model;
    this.#window = ownerWindow;
    this.#captures = new OutputCaptureTransport(model, ownerWindow);
  }

  start(): void {
    if (this.#started) return;
    this.#model.on("msg:custom", this.#handleMessage);
    this.#started = true;
    this.#captures.connect();
  }

  dispose(): void {
    this.#captures.disconnect();
    if (this.#started) this.#model.off("msg:custom", this.#handleMessage);
    this.#started = false;
    for (const pending of this.#pending.values()) {
      this.#window.clearTimeout(pending.timeout);
      pending.reject(
        new LensProtocolError("client_disposed", "Lens closed before the request completed"),
      );
    }
    this.#pending.clear();
    this.#resolvedListeners.clear();
    this.#attentionListeners.clear();
  }

  onSelectionResolved(listener: (event: SelectionResolvedEvent) => void): () => void {
    this.#resolvedListeners.add(listener);
    return () => this.#resolvedListeners.delete(listener);
  }

  onAttention(listener: (event: AttentionEvent) => void): () => void {
    this.#attentionListeners.add(listener);
    return () => this.#attentionListeners.delete(listener);
  }

  onOutputCapture(handler: OutputCaptureHandler): () => void {
    return this.#captures.register(handler);
  }

  putSelection(
    selection: Selection,
    imageAction: ImageAction,
    expectedRevision: number,
    bytes?: Uint8Array,
  ): Promise<LensResponse> {
    return this.#mutate(
      "selection.put",
      { selection, imageAction, expectedRevision },
      bytes ? [exactBytes(bytes).buffer] : [],
    );
  }

  activateSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.#mutate("selection.activate", { selectionId, expectedRevision });
  }

  deleteSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.#mutate("selection.delete", { selectionId, expectedRevision });
  }

  reopenSelection(payload: CommandPayload<"selection.reopen">): Promise<LensResponse> {
    return this.#mutate("selection.reopen", payload);
  }

  clearSelections(expectedRevision: number): Promise<LensResponse> {
    return this.#mutate("selections.clear", { expectedRevision });
  }

  refreshHistory(): Promise<LensResponse> {
    return this.#mutate("history.refresh", {});
  }

  /** Read the annotated PNG that the notebook's record keeps for a resolved selection. */
  async getHistoryImage(sha256: string): Promise<Uint8Array<ArrayBuffer>> {
    const { response, buffers } = await this.#send("history.image", { sha256 });
    const payload = parseReply(() =>
      parseContract(HistoryImageResponsePayloadSchema, response.payload, "History image response"),
    );
    if (payload.sha256 !== sha256) {
      throw new LensProtocolError(
        "invalid_response",
        "History image response must identify the requested image",
      );
    }
    return exactBytes(buffers[0]);
  }

  async getSnapshot(selectionId: string): Promise<SnapshotAsset> {
    const { response, buffers } = await this.#send("snapshot.get", { selectionId });
    const payload = parseReply(() =>
      parseContract(SnapshotResponsePayloadSchema, response.payload, "Snapshot response"),
    );
    if (payload.selectionId !== selectionId || payload.snapshot.id !== `image:${selectionId}`) {
      throw new LensProtocolError(
        "invalid_response",
        "Snapshot response must identify the requested selection",
      );
    }
    return { snapshot: payload.snapshot, bytes: exactBytes(buffers[0]) };
  }

  #mutate<TType extends CommandType>(
    type: TType,
    payload: CommandPayload<TType>,
    buffers: ArrayBuffer[] = [],
  ): Promise<LensResponse> {
    return this.#send(type, payload, buffers).then(({ response }) => response);
  }

  #send<TType extends CommandType>(
    type: TType,
    payload: CommandPayload<TType>,
    buffers: ArrayBuffer[] = [],
  ): Promise<Reply> {
    if (!this.#started) {
      return Promise.reject(
        new LensProtocolError("client_disposed", "Lens is not connected to its widget model"),
      );
    }
    const requestId = createRequestId(this.#window);
    let command: ClientCommand;
    try {
      command = parseContract(
        ClientCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: WIDGET_TRANSPORT_VERSION,
          requestId,
          type,
          payload,
        },
        "Lens command",
      );
      validateOutgoingBuffers(command, buffers);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    return new Promise<Reply>((resolve, reject) => {
      const timeout = this.#window.setTimeout(() => {
        this.#pending.delete(requestId);
        reject(
          new LensProtocolError(
            "timeout",
            "Lens did not respond. Check the notebook connection, then try again.",
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(requestId, { command, resolve, reject, timeout });
      try {
        this.#model.send(command, undefined, buffers);
      } catch (error) {
        this.#window.clearTimeout(timeout);
        this.#pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).then((reply) => {
      if (!reply.response.ok) {
        throw new LensProtocolError(
          reply.response.error.code,
          reply.response.error.message,
          reply.response.revision,
        );
      }
      return reply;
    });
  }

  readonly #handleMessage = (message: TransportValue, buffers: DataView[] = []): void => {
    const envelope = parseTransportEnvelope(message);
    if (!envelope) return;
    switch (envelope.protocol) {
      case "marimo-lens.command":
        this.#captures.accept(envelope, buffers);
        return;
      case "marimo-lens.event":
        this.#acceptEvent(envelope, buffers);
        return;
      case "marimo-lens.response":
        this.#acceptResponse(envelope, buffers);
    }
  };

  #acceptEvent(message: TransportEnvelope, buffers: readonly DataView[]): void {
    if (buffers.length !== 0) return;
    if (message.type === "selection.resolved") {
      const event = tryParse(() => parseSelectionResolvedEvent(message));
      if (event) dispatch(this.#resolvedListeners, event);
    } else {
      const event = tryParse(() => parseAttentionEvent(message));
      if (event) dispatch(this.#attentionListeners, event);
    }
  }

  #acceptResponse(message: TransportEnvelope, buffers: DataView[]): void {
    const requestId = message.requestId;
    const pending = requestId === undefined ? undefined : this.#pending.get(requestId);
    if (!pending) return;
    this.#window.clearTimeout(pending.timeout);
    this.#pending.delete(pending.command.requestId);
    try {
      const response = parseLensResponse(message);
      validateReply(pending.command, response, buffers);
      pending.resolve({ response, buffers });
    } catch (error) {
      pending.reject(
        error instanceof LensProtocolError
          ? error
          : new LensProtocolError(
              "invalid_response",
              error instanceof Error ? error.message : String(error),
            ),
      );
    }
  }
}

function validateOutgoingBuffers(command: ClientCommand, buffers: readonly ArrayBuffer[]): void {
  const expected =
    command.type === "selection.put" && command.payload.imageAction === "replace" ? 1 : 0;
  if (buffers.length === expected) return;
  throw new LensProtocolError(
    "invalid_command",
    expected === 1
      ? "Replacing a snapshot requires one PNG buffer"
      : `${command.type} cannot include a PNG buffer`,
  );
}

/** Check the buffers a reply carries and that a mutation advanced the revision once. */
function validateReply(
  command: ClientCommand,
  response: LensResponse,
  buffers: readonly DataView[],
): void {
  const imageReply =
    response.ok && (command.type === "snapshot.get" || command.type === "history.image");
  const expected = imageReply ? 1 : 0;
  if (buffers.length !== expected) {
    throw new LensProtocolError(
      "invalid_response",
      `${command.type} response must contain ${expected === 0 ? "no buffers" : "one PNG buffer"}`,
    );
  }
  if (
    response.ok &&
    "expectedRevision" in command.payload &&
    response.revision !== command.payload.expectedRevision + 1
  ) {
    throw new LensProtocolError(
      "invalid_response",
      "Selection mutation response must advance the requested revision once",
      response.revision,
    );
  }
}

/** Parse a reply payload, reporting a contract failure as an invalid response. */
function parseReply<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new LensProtocolError(
      "invalid_response",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function dispatch<T>(listeners: ReadonlySet<(event: T) => void>, event: T): void {
  const failures: unknown[] = [];
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

function tryParse<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

function createRequestId(ownerWindow: Window): string {
  const ownerGlobal = ownerWindow.self;
  return (
    ownerWindow.crypto.randomUUID?.() ??
    `request-${ownerGlobal.Date.now().toString(36)}-${ownerGlobal.Math.random()
      .toString(36)
      .slice(2, 10)}`
  );
}
