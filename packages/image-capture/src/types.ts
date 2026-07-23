import type {
  AvailableSnapshot,
  OutputCaptureCommand,
  OutputCaptureImage,
  SelectionSnapshot,
} from "@marimo-lens/protocol";

export type CapturedSnapshot = {
  metadata: AvailableSnapshot;
  bytes: Uint8Array;
};

export type CaptureResult =
  | { status: "available"; snapshot: CapturedSnapshot }
  | {
      status: "failed";
      snapshot: Extract<SelectionSnapshot, { status: "failed" }>;
    };

export type OutputCaptureAsset = Readonly<{
  image: OutputCaptureImage;
  bytes: Uint8Array;
}>;

export type OutputCaptureHandler = (
  command: OutputCaptureCommand,
  signal: AbortSignal,
) => Promise<OutputCaptureAsset>;
