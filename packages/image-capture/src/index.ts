export type {
  CaptureResult,
  CapturedSnapshot,
  OutputCaptureAsset,
  OutputCaptureHandler,
} from "./types";

export { outputContentMetrics, relativeOutputBounds } from "./evidence/geometry";
export { captureOutputSnapshot, captureSelectionSnapshot } from "./evidence/image";
