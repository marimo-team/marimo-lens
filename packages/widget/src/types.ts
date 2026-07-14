export type ViewportPoint = {
  x: number;
  y: number;
};

export type OutputCell = {
  id: string;
  element: HTMLElement;
};

export type CapturedSnapshot = {
  metadata: import("@/contracts").AvailableSnapshot;
  bytes: Uint8Array;
};

export type CaptureResult =
  | { status: "available"; snapshot: CapturedSnapshot }
  | {
      status: "failed";
      snapshot: Extract<import("@/contracts").SelectionSnapshot, { status: "failed" }>;
    };
