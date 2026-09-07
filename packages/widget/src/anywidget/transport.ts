import type {
  ClientCommand,
  LensResponse,
  LensState,
  OutputCaptureCommand,
  OutputCaptureImage,
  TransportInput,
  WIDGET_TRANSPORT_VERSION,
} from "@marimo-lens/protocol";

type OutputCaptureReadinessEvent = {
  protocol: "marimo-lens.event";
  version: typeof WIDGET_TRANSPORT_VERSION;
  type: "output.capture.ready" | "output.capture.unready";
  payload: Readonly<Record<string, never>>;
};

type WidgetOutboundMessage = ClientCommand | LensResponse | OutputCaptureReadinessEvent;
type WidgetMessageHandler = (message: TransportInput, buffers: DataView[]) => void;

export type LensWidgetModel = {
  get(key: "_state"): LensState;
  on(eventName: "msg:custom", handler: WidgetMessageHandler): void;
  off(eventName: "msg:custom", handler: WidgetMessageHandler): void;
  send(
    message: WidgetOutboundMessage,
    callbacks?: undefined,
    buffers?: ArrayBuffer[] | ArrayBufferView[],
  ): void;
};

export type OutputCaptureAsset = Readonly<{
  image: OutputCaptureImage;
  bytes: Uint8Array;
}>;

export type OutputCaptureHandler = (
  command: OutputCaptureCommand,
  signal: AbortSignal,
) => Promise<OutputCaptureAsset>;
