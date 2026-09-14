import type {
  ClearSelectionsResponsePayload,
  ClientCommand,
  CommandPayload,
  CommandType,
  LensResponse,
  SelectionMutationResponsePayload,
  SelectionPutResponsePayload,
  SnapshotResponsePayload,
  TransportEnvelope,
} from "@marimo-lens/protocol";

import {
  WIDGET_TRANSPORT_VERSION,
  ClearSelectionsResponsePayloadSchema as EmptyResponsePayloadSchema,
  ClientCommandSchema,
  SelectionMutationResponsePayloadSchema,
  SelectionPutResponsePayloadSchema,
  SnapshotResponsePayloadSchema,
  parseContract,
  parseLensResponse,
} from "@marimo-lens/protocol";

import type { LensWidgetModel } from "@/anywidget/transport";

import { LensProtocolError } from "@/anywidget/error";

const REQUEST_TIMEOUT_MS = 20_000;

type ResponsePayloadByCommand = {
  "selection.put": SelectionPutResponsePayload;
  "selection.activate": SelectionMutationResponsePayload;
  "selection.delete": SelectionMutationResponsePayload;
  "selection.reopen": SelectionMutationResponsePayload;
  "selections.clear": ClearSelectionsResponsePayload;
  "history.clear": ClearSelectionsResponsePayload;
  "snapshot.get": SnapshotResponsePayload;
};

export type RequestReply<TType extends CommandType> = {
  response: LensResponse;
  payload: ResponsePayloadByCommand[TType];
  buffers: DataView[];
};

type AnyRequestReply = RequestReply<CommandType>;

type PendingRequest = {
  command: ClientCommand;
  resolve: (reply: AnyRequestReply) => void;
  reject: (error: Error) => void;
  timeout: number;
};

export class RequestClient {
  readonly #model: LensWidgetModel;
  readonly #window: Window;
  readonly #pending = new Map<string, PendingRequest>();
  #connected = false;

  constructor(model: LensWidgetModel, ownerWindow: Window) {
    this.#model = model;
    this.#window = ownerWindow;
  }

  connect(): void {
    this.#connected = true;
  }

  disconnect(): void {
    this.#connected = false;
    for (const pending of this.#pending.values()) {
      this.#window.clearTimeout(pending.timeout);
      pending.reject(
        new LensProtocolError("client_disposed", "Lens closed before the request completed"),
      );
    }
    this.#pending.clear();
  }

  send(
    type: "selection.put",
    payload: CommandPayload<"selection.put">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"selection.put">>;
  send(
    type: "selection.activate",
    payload: CommandPayload<"selection.activate">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"selection.activate">>;
  send(
    type: "selection.delete",
    payload: CommandPayload<"selection.delete">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"selection.delete">>;
  send(
    type: "selection.reopen",
    payload: CommandPayload<"selection.reopen">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"selection.reopen">>;
  send(
    type: "selections.clear",
    payload: CommandPayload<"selections.clear">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"selections.clear">>;
  send(
    type: "history.clear",
    payload: CommandPayload<"history.clear">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"history.clear">>;
  send(
    type: "snapshot.get",
    payload: CommandPayload<"snapshot.get">,
    buffers?: ArrayBuffer[],
  ): Promise<RequestReply<"snapshot.get">>;
  send(
    type: CommandType,
    payload: CommandPayload<CommandType>,
    buffers: ArrayBuffer[] = [],
  ): Promise<AnyRequestReply> {
    if (!this.#connected) {
      return Promise.reject(
        new LensProtocolError("client_disposed", "Lens is not connected to its widget model"),
      );
    }
    const requestId = createRequestId(this.#window);
    const command = parseContract(
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

    const request = new Promise<AnyRequestReply>((resolve, reject) => {
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
    return request;
  }

  accept(message: TransportEnvelope, buffers: DataView[] = []): boolean {
    if (message.protocol !== "marimo-lens.response") return false;
    const requestId = message.requestId;
    if (requestId === undefined) return true;
    const pending = this.#pending.get(requestId);
    if (!pending) return true;
    try {
      const response = parseLensResponse(message);
      const payload = validateClientReply(pending.command, response, buffers);
      this.#finish(requestId, pending);
      pending.resolve({ response, payload, buffers });
    } catch (error) {
      this.#finish(requestId, pending);
      const cause = error instanceof Error ? error : new Error(String(error));
      pending.reject(invalidResponse(cause));
    }
    return true;
  }

  #finish(requestId: string, pending: PendingRequest): void {
    this.#window.clearTimeout(pending.timeout);
    this.#pending.delete(requestId);
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

function validateClientReply(
  command: ClientCommand,
  response: LensResponse,
  buffers: readonly DataView[],
): ResponsePayloadByCommand[CommandType] {
  if (!response.ok) {
    requireResponseBuffers(command.type, buffers, 0);
    return parseContract(EmptyResponsePayloadSchema, response.payload, "Failed Lens response");
  }

  requireResponseBuffers(command.type, buffers, command.type === "snapshot.get" ? 1 : 0);
  switch (command.type) {
    case "selection.put": {
      requireMutationRevision(command, response);
      const payload = parseContract(
        SelectionPutResponsePayloadSchema,
        response.payload,
        "Selection put response",
      );
      if (payload.selection.id !== command.payload.selection.id) {
        throw new LensProtocolError(
          "invalid_response",
          "Selection put response must identify the submitted selection",
        );
      }
      return payload;
    }
    case "selection.activate":
    case "selection.delete":
    case "selection.reopen": {
      requireMutationRevision(command, response);
      const payload = parseContract(
        SelectionMutationResponsePayloadSchema,
        response.payload,
        "Selection mutation response",
      );
      if (payload.selectionId !== command.payload.selectionId) {
        throw new LensProtocolError(
          "invalid_response",
          "Selection mutation response must identify the requested selection",
        );
      }
      return payload;
    }
    case "selections.clear":
    case "history.clear":
      requireMutationRevision(command, response);
      return parseContract(
        EmptyResponsePayloadSchema,
        response.payload,
        "Clear selections response",
      );
    case "snapshot.get": {
      const payload = parseContract(
        SnapshotResponsePayloadSchema,
        response.payload,
        "Snapshot response",
      );
      if (payload.selectionId !== command.payload.selectionId) {
        throw new LensProtocolError(
          "invalid_response",
          "Snapshot response must identify the requested selection",
        );
      }
      if (payload.snapshot.id !== `image:${command.payload.selectionId}`) {
        throw new LensProtocolError(
          "invalid_response",
          "Snapshot response image must identify the requested selection",
        );
      }
      return payload;
    }
  }
}

function requireMutationRevision(
  command: Extract<ClientCommand, { payload: { expectedRevision: number } }>,
  response: LensResponse,
): void {
  if (response.revision === command.payload.expectedRevision + 1) return;
  throw new LensProtocolError(
    "invalid_response",
    "Selection mutation response must advance the requested revision once",
    response.revision,
  );
}

function requireResponseBuffers(
  type: CommandType,
  buffers: readonly DataView[],
  expected: number,
): void {
  if (buffers.length === expected) return;
  throw new LensProtocolError(
    "invalid_response",
    `${type} response must contain ${expected === 0 ? "no buffers" : "one PNG buffer"}`,
  );
}

function invalidResponse(error: Error): Error {
  if (error instanceof LensProtocolError) return error;
  return new LensProtocolError("invalid_response", error.message);
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
