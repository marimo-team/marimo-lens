import type { AnyModel } from "@anywidget/types";
import type { OutputCaptureAsset, OutputCaptureHandler } from "@marimo-lens/image-capture";
import type { OutputCaptureCommand } from "@marimo-lens/protocol";

import {
  WIDGET_TRANSPORT_VERSION,
  boundedUtf16,
  hasTextContent,
  OutputCaptureFailurePayloadSchema,
  OutputCaptureImageSchema,
  OutputCaptureResponsePayloadSchema,
  parseContract,
  parseLensState,
  parseOutputCaptureCommand,
} from "@marimo-lens/protocol";

import { LensProtocolError } from "@/anywidget/error";

const COMMAND_PROTOCOL = "marimo-lens.command";
const CAPTURE_TIMEOUT_MS = 15_000;

type ActiveCapture = {
  command: OutputCaptureCommand;
  controller: AbortController;
  timeout: number;
};

export class OutputCaptureTransport {
  readonly #model: AnyModel;
  readonly #window: Window;
  #active: ActiveCapture | null = null;
  #handler: OutputCaptureHandler | null = null;
  #captureReady = false;
  #connected = false;

  constructor(model: AnyModel, ownerWindow: Window) {
    this.#model = model;
    this.#window = ownerWindow;
  }

  connect(): void {
    if (this.#connected) return;
    this.#connected = true;
    if (this.#handler) this.#publishReadiness(true);
  }

  disconnect(): void {
    this.#abortActive("Lens output capture disconnected");
    this.#publishReadiness(false);
    this.#connected = false;
    this.#handler = null;
  }

  register(handler: OutputCaptureHandler): () => void {
    if (this.#handler) {
      throw new LensProtocolError(
        "capture_handler_conflict",
        "Lens already has an active output capture handler",
      );
    }
    this.#handler = handler;
    this.#publishReadiness(true);
    return () => {
      if (this.#handler !== handler) return;
      this.#handler = null;
      this.#abortActive("Lens output capture view was released");
      this.#publishReadiness(false);
    };
  }

  accept(message: unknown, buffers: readonly DataView[] = []): boolean {
    if (!isCommandMessage(message)) return false;
    let command: OutputCaptureCommand;
    try {
      command = parseOutputCaptureCommand(message);
    } catch {
      return true;
    }
    if (buffers.length !== 0) {
      this.#replyFailure(
        command,
        "invalid_command",
        "Output capture commands cannot include binary buffers",
      );
      return true;
    }
    void this.#capture(command);
    return true;
  }

  async #capture(command: OutputCaptureCommand): Promise<void> {
    const handler = this.#handler;
    if (!handler) {
      this.#replyFailure(
        command,
        "browser_unavailable",
        "No displayed Lens can capture notebook output",
      );
      return;
    }
    this.#abortActive("Output capture was superseded by a newer request");

    const controller = new AbortController();
    const active: ActiveCapture = {
      command,
      controller,
      timeout: this.#window.setTimeout(() => {
        controller.abort(
          new LensProtocolError(
            "capture_timeout",
            "Output capture did not finish within 15 seconds",
          ),
        );
      }, CAPTURE_TIMEOUT_MS),
    };
    this.#active = active;

    try {
      const asset = await abortable(handler(command, controller.signal), controller.signal);
      if (this.#active !== active) return;
      this.#replySuccess(command, validateAsset(command, asset));
    } catch (error) {
      if (this.#active !== active) return;
      const failure = captureFailure(error, controller.signal);
      this.#replyFailure(command, failure.code, failure.message);
    } finally {
      this.#window.clearTimeout(active.timeout);
      if (this.#active === active) this.#active = null;
    }
  }

  #replySuccess(command: OutputCaptureCommand, asset: OutputCaptureAsset): void {
    const payload = parseContract(
      OutputCaptureResponsePayloadSchema,
      { outputCellId: command.payload.outputCellId, image: asset.image },
      "Output capture response",
    );
    this.#model.send(
      {
        protocol: "marimo-lens.response",
        version: WIDGET_TRANSPORT_VERSION,
        requestId: command.requestId,
        ok: true,
        revision: this.#currentRevision(),
        payload,
      },
      undefined,
      [exactArrayBuffer(asset.bytes)],
    );
  }

  #replyFailure(command: OutputCaptureCommand, code: string, message: string): void {
    const errorCode = boundedUtf16(code, 128);
    const errorMessage = boundedUtf16(message, 500);
    const payload = parseContract(
      OutputCaptureFailurePayloadSchema,
      { outputCellId: command.payload.outputCellId },
      "Output capture failure",
    );
    this.#model.send(
      {
        protocol: "marimo-lens.response",
        version: WIDGET_TRANSPORT_VERSION,
        requestId: command.requestId,
        ok: false,
        revision: this.#currentRevision(),
        payload,
        error: {
          code: hasTextContent(errorCode) ? errorCode : "capture_failed",
          message: hasTextContent(errorMessage) ? errorMessage : "Output capture failed",
        },
      },
      undefined,
      [],
    );
  }

  #abortActive(message: string): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    this.#window.clearTimeout(active.timeout);
    active.controller.abort(new LensProtocolError("capture_failed", message));
  }

  #currentRevision(): number {
    return parseLensState(this.#model.get("_state")).revision;
  }

  #publishReadiness(ready: boolean): void {
    if (!this.#connected || this.#captureReady === ready) return;
    try {
      this.#model.send(
        {
          protocol: "marimo-lens.event",
          version: WIDGET_TRANSPORT_VERSION,
          type: ready ? "output.capture.ready" : "output.capture.unready",
          payload: {},
        },
        undefined,
        [],
      );
      this.#captureReady = ready;
    } catch {
      if (!ready) this.#captureReady = false;
    }
  }
}

function validateAsset(
  command: OutputCaptureCommand,
  asset: OutputCaptureAsset,
): OutputCaptureAsset {
  const image = parseContract(OutputCaptureImageSchema, asset.image, "Output capture image");
  if (image.id !== `image:${command.requestId}` || asset.bytes.byteLength === 0) {
    throw new LensProtocolError("capture_failed", "Output capture returned invalid image data");
  }
  return { image, bytes: new Uint8Array(asset.bytes) };
}

function captureFailure(error: unknown, signal: AbortSignal): { code: string; message: string } {
  const value = signal.aborted ? signal.reason : error;
  if (isCodedError(value)) {
    return { code: value.code, message: value.message };
  }
  return {
    code: "capture_failed",
    message: value instanceof Error ? value.message : "Output capture failed",
  };
}

function isCodedError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function isCommandMessage(message: unknown): message is { protocol: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "protocol" in message &&
    message.protocol === COMMAND_PROTOCOL
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
