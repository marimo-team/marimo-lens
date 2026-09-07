import type {
  AttentionEvent,
  ImageAction,
  LensResponse,
  Selection,
  SelectionResolvedEvent,
  StoredSnapshot,
  TransportInput,
} from "@marimo-lens/protocol";

import { parseTransportEnvelope } from "@marimo-lens/protocol";

import type { LensWidgetModel, OutputCaptureHandler } from "@/anywidget/transport";

import { LensProtocolError } from "@/anywidget/error";
import { EventRouter } from "@/anywidget/event-router";
import { OutputCaptureTransport } from "@/anywidget/output-capture-transport";
import { RequestClient } from "@/anywidget/request-client";

export { LensProtocolError };

export type SnapshotAsset = {
  snapshot: StoredSnapshot;
  bytes: Uint8Array;
};

export class LensProtocolClient {
  readonly #model: LensWidgetModel;
  readonly #requests: RequestClient;
  readonly #events = new EventRouter();
  readonly #captures: OutputCaptureTransport;
  #started = false;

  constructor(model: LensWidgetModel, ownerWindow: Window) {
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

  onAttention(listener: (event: AttentionEvent) => void): () => void {
    return this.#events.onAttention(listener);
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
    return this.#requests
      .send(
        "selection.put",
        { selection, imageAction, expectedRevision },
        bytes ? [exactArrayBuffer(bytes)] : [],
      )
      .then(({ response }) => response);
  }

  activateSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.#requests
      .send("selection.activate", { selectionId, expectedRevision })
      .then(({ response }) => response);
  }

  deleteSelection(selectionId: string, expectedRevision: number): Promise<LensResponse> {
    return this.#requests
      .send("selection.delete", { selectionId, expectedRevision })
      .then(({ response }) => response);
  }

  reopenSelection(
    selectionId: string,
    resolutionRevision: number,
    expectedRevision: number,
  ): Promise<LensResponse> {
    return this.#requests
      .send("selection.reopen", {
        selectionId,
        resolutionRevision,
        expectedRevision,
      })
      .then(({ response }) => response);
  }

  clearSelections(expectedRevision: number): Promise<LensResponse> {
    return this.#requests
      .send("selections.clear", { expectedRevision })
      .then(({ response }) => response);
  }

  clearHistory(expectedRevision: number): Promise<LensResponse> {
    return this.#requests
      .send("history.clear", { expectedRevision })
      .then(({ response }) => response);
  }

  async getSnapshot(selectionId: string): Promise<SnapshotAsset> {
    const { payload, buffers } = await this.#requests.send("snapshot.get", { selectionId });
    return {
      snapshot: payload.snapshot,
      bytes: exactBytes(buffers[0]),
    };
  }

  readonly #handleMessage = (message: TransportInput, buffers: DataView[] = []): void => {
    const envelope = parseTransportEnvelope(message);
    if (!envelope) return;
    if (this.#captures.accept(envelope, buffers)) return;
    if (this.#events.accept(envelope, buffers)) return;
    this.#requests.accept(envelope, buffers);
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
