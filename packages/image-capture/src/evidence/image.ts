import { boundedUtf16, parseErrorCause } from "@marimo-lens/protocol";

import type { CapturedSnapshot, CaptureResult } from "../types";
import type { RasterizeElement } from "./raster";

import { composeOutputEvidence, composeSelectionEvidence } from "./evidence-layout";
import {
  captureOutputEvidence,
  captureSelectionEvidence,
  type SelectionCaptureOptions,
} from "./evidence-source";
import { isCaptureAbort, ownerWindow, throwIfCaptureAborted } from "./owner-realm";
import { encodePng } from "./png";

type OutputCaptureOptions = {
  imageId: string;
  output: HTMLElement;
  signal?: AbortSignal;
};

export async function captureOutputSnapshot(
  options: OutputCaptureOptions,
): Promise<CapturedSnapshot> {
  return captureOutputSnapshotWith(options);
}

export async function captureSelectionSnapshot(
  options: SelectionCaptureOptions,
): Promise<CaptureResult> {
  return captureSelectionSnapshotWith(options);
}

export function createSnapshotCapture(rasterize: RasterizeElement) {
  return {
    captureOutputSnapshot: (options: OutputCaptureOptions) =>
      captureOutputSnapshotWith(options, rasterize),
    captureSelectionSnapshot: (options: SelectionCaptureOptions) =>
      captureSelectionSnapshotWith(options, rasterize),
  };
}

async function captureOutputSnapshotWith(
  options: OutputCaptureOptions,
  rasterize?: RasterizeElement,
): Promise<CapturedSnapshot> {
  const ownerDocument = options.output.ownerDocument;
  const capturedAt = new (ownerWindow(ownerDocument).Date)().toISOString();
  throwIfCaptureAborted(options.signal, ownerDocument);
  const evidence = await captureOutputEvidence(options.output, options.signal, rasterize);
  throwIfCaptureAborted(options.signal, ownerDocument);
  const canvas = composeOutputEvidence({
    ownerDocument,
    ...evidence,
  });
  const encoded = await encodePng(canvas, options.signal);
  throwIfCaptureAborted(options.signal, ownerDocument);
  return {
    metadata: {
      status: "available",
      id: options.imageId,
      mediaType: "image/png",
      width: encoded.width,
      height: encoded.height,
      sha256: encoded.sha256,
      capturedAt,
    },
    bytes: encoded.bytes,
  };
}

async function captureSelectionSnapshotWith(
  options: SelectionCaptureOptions,
  rasterize?: RasterizeElement,
): Promise<CaptureResult> {
  const ownerDocument = options.output.ownerDocument;
  const capturedAt = new (ownerWindow(ownerDocument).Date)().toISOString();
  try {
    throwIfCaptureAborted(options.signal, ownerDocument);
    const evidence = await captureSelectionEvidence(options, undefined, rasterize);
    throwIfCaptureAborted(options.signal, ownerDocument);
    const canvas = composeSelectionEvidence({
      ownerDocument,
      anchor: options.anchor,
      label: options.label,
      ...evidence,
    });
    const encoded = await encodePng(canvas, options.signal);
    throwIfCaptureAborted(options.signal, ownerDocument);
    return {
      status: "available",
      snapshot: {
        metadata: {
          status: "available",
          id: `image:${options.selectionId}`,
          mediaType: "image/png",
          width: encoded.width,
          height: encoded.height,
          sha256: encoded.sha256,
          capturedAt,
        },
        bytes: encoded.bytes,
      },
    };
  } catch (error) {
    if (isCaptureAbort(error)) throw error;
    return {
      status: "failed",
      snapshot: {
        status: "failed",
        capturedAt,
        error: boundedUtf16(errorText(error) ?? "Snapshot capture failed", 240),
      },
    };
  }
}

function errorText(cause: unknown): string | null {
  return parseErrorCause(cause)?.message || null;
}
