import type { AnyModel } from "@anywidget/types";
import type { OutputCaptureHandler } from "@marimo-lens/image-capture";
import type {
  CellAttentionEvent,
  CommandPayload,
  CommandType,
  ImageAction,
  LensResponse,
  Selection,
  SelectionResolvedEvent,
  StoredSnapshot,
} from "@marimo-lens/protocol";

import { LensProtocolError } from "@/anywidget/error";
import { EventRouter } from "@/anywidget/event-router";
import { OutputCaptureTransport } from "@/anywidget/output-capture-transport";
import { RequestClient, type RequestReply } from "@/anywidget/request-client";

export type { OutputCaptureAsset } from "@marimo-lens/image-capture";
export { LensProtocolError };

export type SnapshotAsset = {
  snapshot: StoredSnapshot;
  bytes: Uint8Array;
};

export class LensProtocolClient {
  readonly #model: AnyModel;
  readonly #requests: RequestClient;
  readonly #events = new EventRouter();
  readonly #captures: OutputCaptureTransport;
  #started = false;

  constructor(model: AnyModel, ownerWindow: Window) {
    this.#model = model;
    this.#requests = new RequestClient(model, ownerWindow);
    this.#captures = new OutputCaptureTransport(model, ownerWindow);
  }

  start(): void {
    if (this.#started) return;
    this.#model.on("msg:custom", this.#handleMessage);
    this.#started = true;
    this.#requests.connect();
    this.#captures.connect();
  }

  dispose(): void {
    this.#captures.disconnect();
    if (this.#started) this.#model.off("msg:custom", this.#handleMessage);
    this.#started = false;
    this.#requests.disconnect();
    this.#events.clear();
  }

  onSelectionResolved(listener: (event: SelectionResolvedEvent) => void): () => void {
    return this.#events.onSelectionResolved(listener);
  }

  onCellAttention(listener: (event: CellAttentionEvent) => void): () => void {
    return this.#events.onCellAttention(listener);
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
    return this.#request(
      "selection.put",
      { selection, imageAction, expectedRevision },
      bytes ? [exactArrayBuffer(bytes)] : [],
    ).then(({ response }) => response);
  }

  activateSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.#request("selection.activate", { selectionId, expectedRevision }).then(
      ({ response }) => response,
    );
  }

  deleteSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.#request("selection.delete", { selectionId, expectedRevision }).then(
      ({ response }) => response,
    );
  }

  reopenSelection(
    selectionId: string,
    resolutionRevision: number,
    expectedRevision: number,
  ): Promise<LensResponse> {
    return this.#request("selection.reopen", {
      selectionId,
      resolutionRevision,
      expectedRevision,
    }).then(({ response }) => response);
  }

  clearSelections(expectedRevision: number): Promise<LensResponse> {
    return this.#request("selections.clear", { expectedRevision }).then(({ response }) => response);
  }

  clearHistory(expectedRevision: number): Promise<LensResponse> {
    return this.#request("history.clear", { expectedRevision }).then(({ response }) => response);
  }

  async getSnapshot(selectionId: string): Promise<SnapshotAsset> {
    const { payload, buffers } = await this.#request("snapshot.get", { selectionId });
    return {
      snapshot: payload.snapshot,
      bytes: exactBytes(buffers[0]),
    };
  }

  #request<TType extends CommandType>(
    type: TType,
    payload: CommandPayload<TType>,
    buffers: ArrayBuffer[] = [],
  ): Promise<RequestReply<TType>> {
    return this.#requests.send(type, payload, buffers);
  }

  readonly #handleMessage = (message: unknown, buffers: DataView[] = []): void => {
    if (this.#captures.accept(message, buffers)) return;
    if (this.#events.accept(message, buffers)) return;
    this.#requests.accept(message, buffers);
  };
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function exactBytes(view: DataView): Uint8Array {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
