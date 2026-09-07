import type { AvailableSnapshot, SelectionSnapshot } from "@marimo-lens/protocol";

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
