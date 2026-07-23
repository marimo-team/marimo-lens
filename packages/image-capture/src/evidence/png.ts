import { ownerError, ownerWindow, throwIfCaptureAborted, type OwnerWindow } from "./owner-realm";

export const MAX_CAPTURE_EDGE = 2_048;
const MAX_AREA = 4_000_000;
const MAX_BYTES = 8 * 1_024 * 1_024;
const MIN_ENCODED_EDGE = 512;

export type EncodedPng = {
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
};

export function exceedsCaptureDimensions(width: number, height: number): boolean {
  return width > MAX_CAPTURE_EDGE || height > MAX_CAPTURE_EDGE || width * height > MAX_AREA;
}

export function captureRasterSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(
    1,
    MAX_CAPTURE_EDGE / safeWidth,
    MAX_CAPTURE_EDGE / safeHeight,
    Math.sqrt(MAX_AREA / (safeWidth * safeHeight)),
  );
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
  };
}

export async function encodePng(
  original: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<EncodedPng> {
  const ownerDocument = original.ownerDocument;
  const window = ownerWindow(ownerDocument);
  let canvas = original;
  for (;;) {
    throwIfCaptureAborted(signal, ownerDocument);
    const blob = await canvasToPng(canvas);
    throwIfCaptureAborted(signal, ownerDocument);
    if (blob.size <= MAX_BYTES) {
      const bytes = new window.Uint8Array(await blob.arrayBuffer());
      throwIfCaptureAborted(signal, ownerDocument);
      return {
        bytes,
        width: canvas.width,
        height: canvas.height,
        sha256: await hashBytes(bytes, window),
      };
    }
    if (Math.max(canvas.width, canvas.height) <= MIN_ENCODED_EDGE) {
      throw ownerError(ownerDocument, "Captured image exceeds the 8 MiB limit");
    }
    const resized = ownerDocument.createElement("canvas");
    resized.width = Math.max(1, Math.floor(canvas.width * 0.82));
    resized.height = Math.max(1, Math.floor(canvas.height * 0.82));
    const context = resized.getContext("2d");
    if (!context) throw ownerError(ownerDocument, "Canvas rendering is unavailable");
    context.drawImage(canvas, 0, 0, resized.width, resized.height);
    canvas = resized;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(ownerError(canvas.ownerDocument, "Captured image could not be encoded"));
    }, "image/png");
  });
}

async function hashBytes(bytes: Uint8Array, window: OwnerWindow): Promise<string> {
  const copy = new window.Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await window.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new window.Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
