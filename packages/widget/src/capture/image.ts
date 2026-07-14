import { toPng } from "html-to-image";

import type { DomHintBounds, SelectionAnchor } from "@/contracts";
import type { CaptureResult } from "@/types";

import { boundedUtf16 } from "@/bounded-text";
import { anchorCenter } from "@/capture/anchor";

const MAX_EDGE = 2_048;
const MAX_AREA = 4_000_000;
const MAX_BYTES = 8 * 1_024 * 1_024;
const MIN_ENCODED_EDGE = 512;
const COMPOSITE_GAP = 20;
const COMPOSITE_PADDING = 24;
const MARKER_COLOR = "#0880ea";
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";
const HIDE_SCROLLBARS = `
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; }
`;

export const NECESSARY_STYLE_PROPERTIES = [
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "box-sizing",
  "aspect-ratio",
  "display",
  "position",
  "top",
  "left",
  "bottom",
  "right",
  "z-index",
  "float",
  "clear",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "justify-content",
  "gap",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "row-gap",
  "column-gap",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "text-indent",
  "text-shadow",
  "white-space",
  "text-wrap",
  "word-break",
  "text-overflow",
  "vertical-align",
  "color",
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-clip",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "outline",
  "box-shadow",
  "opacity",
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "transform",
  "clip-path",
  "overflow",
  "overflow-x",
  "overflow-y",
  "visibility",
  "fill",
  "stroke",
  "stroke-width",
  "object-fit",
  "object-position",
  "list-style",
  "list-style-type",
  "border-collapse",
  "border-spacing",
  "content",
  "cursor",
] as const;

type CaptureOptions = {
  selectionId: string;
  label: string;
  anchor: SelectionAnchor;
  output: HTMLElement;
  detailElement?: Element;
  signal?: AbortSignal;
};

type DetailCapture = {
  image: HTMLImageElement;
  bounds: DomHintBounds;
};

type DetailSnapshot = {
  element: HTMLElement;
  bounds: DomHintBounds;
};

type ElementCaptureGeometry = {
  width: number;
  height: number;
  style: Record<string, string>;
};

type EvidenceLayout = {
  width: number;
  height: number;
  overview: DrawRegion;
  detail?: DrawRegion;
};

type DrawRegion = { x: number; y: number; width: number; height: number };

export async function captureSelectionSnapshot(options: CaptureOptions): Promise<CaptureResult> {
  const capturedAt = new Date().toISOString();
  try {
    throwIfAborted(options.signal);
    const sources = await captureEvidenceSources(options);
    throwIfAborted(options.signal);
    const canvas = composeEvidenceImage({ ...options, ...sources });
    const encoded = await encodeWithinLimit(canvas, options.signal);
    const bytes = new Uint8Array(await encoded.blob.arrayBuffer());
    throwIfAborted(options.signal);
    const sha256 = await hashBytes(bytes);
    throwIfAborted(options.signal);
    return {
      status: "available",
      snapshot: {
        metadata: {
          status: "available",
          id: `image:${options.selectionId}`,
          mediaType: "image/png",
          width: encoded.canvas.width,
          height: encoded.canvas.height,
          sha256,
          capturedAt,
        },
        bytes,
      },
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      status: "failed",
      snapshot: {
        status: "failed",
        capturedAt,
        error:
          error instanceof Error ? boundedUtf16(error.message, 240) : "Snapshot capture failed",
      },
    };
  }
}

export async function captureEvidenceSources(
  options: CaptureOptions,
  backgroundColor = resolveBackgroundColor(options.output),
): Promise<{
  overview: HTMLImageElement;
  detail: DetailCapture | null;
  backgroundColor: string;
}> {
  const detailSnapshot = snapshotDetail(options);
  const detail = detailSnapshot
    ? await captureDetail(detailSnapshot, backgroundColor, options.signal)
    : null;
  throwIfAborted(options.signal);
  const overviewDataUrl = await captureElement(
    options.output,
    backgroundColor,
    true,
    options.signal,
  );
  const overview = await loadImage(overviewDataUrl, options.signal);
  return { overview, detail, backgroundColor };
}

export function evidenceLayout(
  sourceWidth: number,
  sourceHeight: number,
  includeDetail: boolean,
): EvidenceLayout {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const needsComposite =
    includeDetail ||
    safeWidth > MAX_EDGE ||
    safeHeight > MAX_EDGE ||
    safeWidth * safeHeight > MAX_AREA;
  if (!needsComposite) {
    const size = captureRasterSize(safeWidth, safeHeight);
    return {
      width: size.width,
      height: size.height,
      overview: {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      },
    };
  }

  const width = Math.min(MAX_EDGE, Math.max(800, safeWidth));
  const contentWidth = width - COMPOSITE_PADDING * 2;
  const overviewHeight = Math.min(1_080, Math.max(360, (safeHeight / safeWidth) * contentWidth));
  const detailHeight = Math.min(
    760,
    MAX_EDGE - overviewHeight - COMPOSITE_GAP - COMPOSITE_PADDING * 2,
  );
  const height = Math.round(
    Math.min(MAX_EDGE, COMPOSITE_PADDING * 2 + overviewHeight + COMPOSITE_GAP + detailHeight),
  );
  return fitEvidenceLayout({
    width: Math.round(width),
    height,
    overview: {
      x: COMPOSITE_PADDING,
      y: COMPOSITE_PADDING,
      width: contentWidth,
      height: overviewHeight,
    },
    detail: {
      x: COMPOSITE_PADDING,
      y: COMPOSITE_PADDING + overviewHeight + COMPOSITE_GAP,
      width: contentWidth,
      height: Math.max(1, height - (COMPOSITE_PADDING * 2 + overviewHeight + COMPOSITE_GAP)),
    },
  });
}

function fitEvidenceLayout(layout: EvidenceLayout): EvidenceLayout {
  const size = captureRasterSize(layout.width, layout.height);
  const scale = Math.min(size.width / layout.width, size.height / layout.height);
  if (scale >= 1) return layout;
  const scaleRegion = (region: DrawRegion): DrawRegion => ({
    x: region.x * scale,
    y: region.y * scale,
    width: region.width * scale,
    height: region.height * scale,
  });
  return {
    width: size.width,
    height: size.height,
    overview: scaleRegion(layout.overview),
    detail: layout.detail ? scaleRegion(layout.detail) : undefined,
  };
}

function snapshotDetail(options: CaptureOptions): DetailSnapshot | null {
  if (!options.detailElement) return null;
  const target =
    options.detailElement === options.output
      ? options.output
      : detailCaptureElement(options.detailElement, options.output);
  const needsDetail =
    target === options.output
      ? isLargeOutput(options.output)
      : hasScrolledAncestor(target, options.output) || isLargeOutput(options.output);
  if (!needsDetail) return null;
  return {
    element: target,
    bounds: relativeElementBounds(target, options.output),
  };
}

async function captureDetail(
  snapshot: DetailSnapshot,
  backgroundColor: string,
  signal?: AbortSignal,
): Promise<DetailCapture> {
  const dataUrl = await captureElement(snapshot.element, backgroundColor, false, signal);
  return {
    image: await loadImage(dataUrl, signal),
    bounds: snapshot.bounds,
  };
}

async function captureElement(
  element: HTMLElement,
  backgroundColor: string,
  captureFullOutput: boolean,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const geometry = elementCaptureGeometry(element, captureFullOutput);
  assertCapturableIframes(element);
  const raster = captureRasterSize(geometry.width, geometry.height);
  const dataUrl = await toPng(element, {
    backgroundColor,
    width: geometry.width,
    height: geometry.height,
    canvasWidth: raster.width,
    canvasHeight: raster.height,
    pixelRatio: 1,
    imagePlaceholder: TRANSPARENT_PIXEL,
    includeStyleProperties: [...NECESSARY_STYLE_PROPERTIES],
    extraStyleContent: HIDE_SCROLLBARS,
    filter: shouldCaptureNode,
    style: geometry.style,
  });
  throwIfAborted(signal);
  return dataUrl;
}

export function elementCaptureGeometry(
  element: HTMLElement,
  captureFullOutput: boolean,
): ElementCaptureGeometry {
  const rect = element.getBoundingClientRect();
  const viewportWidth = Math.max(rect.width, 1);
  const viewportHeight = Math.max(rect.height, 1);
  const contentWidth = Math.max(element.scrollWidth, viewportWidth);
  const contentHeight = Math.max(element.scrollHeight, viewportHeight);
  if (captureFullOutput) {
    return {
      width: contentWidth,
      height: contentHeight,
      style: { maxHeight: "none", overflow: "visible" },
    };
  }
  return {
    width: viewportWidth,
    height: viewportHeight,
    style: {
      width: `${contentWidth}px`,
      height: `${contentHeight}px`,
      maxWidth: "none",
      maxHeight: "none",
      overflow: "visible",
      position: "relative",
      inset: "auto",
      top: "0",
      left: "0",
      right: "auto",
      bottom: "auto",
      transform: `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`,
      transformOrigin: "top left",
    },
  };
}

function composeEvidenceImage(
  options: CaptureOptions & {
    overview: HTMLImageElement;
    detail: DetailCapture | null;
    backgroundColor: string;
  },
): HTMLCanvasElement {
  const layout = evidenceLayout(
    options.overview.naturalWidth,
    options.overview.naturalHeight,
    options.detail !== null,
  );
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable");
  context.fillStyle = options.backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const overviewRegion = drawContained(context, options.overview, layout.overview);
  // A detail capture owns the marker when present. Nested scroll positions can
  // reset in the overview clone, while the captured detail remains spatially exact.
  if (!layout.detail) drawMarker(context, options.anchor, options.label, overviewRegion);

  if (layout.detail) {
    context.fillStyle = "rgba(127, 127, 127, 0.24)";
    context.fillRect(
      layout.detail.x,
      layout.detail.y - COMPOSITE_GAP / 2 - 0.5,
      layout.detail.width,
      1,
    );
    if (options.detail) {
      const detailRegion = drawContained(context, options.detail.image, layout.detail);
      const detailAnchor = anchorForDetail(options.anchor, options.detail.bounds);
      drawMarker(context, detailAnchor, options.label, detailRegion);
    } else {
      drawCroppedDetail(context, options.overview, options.anchor, options.label, layout.detail);
    }
  }
  return canvas;
}

function drawContained(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  destination: DrawRegion,
): DrawRegion {
  const scale = Math.min(
    destination.width / image.naturalWidth,
    destination.height / image.naturalHeight,
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const region = {
    x: destination.x + (destination.width - width) / 2,
    y: destination.y + (destination.height - height) / 2,
    width,
    height,
  };
  context.drawImage(image, region.x, region.y, region.width, region.height);
  return region;
}

function drawCroppedDetail(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  anchor: SelectionAnchor,
  label: string,
  destination: DrawRegion,
): void {
  const center = anchorCenter(anchor);
  const cropAspect = destination.width / destination.height;
  let cropWidth = Math.min(image.naturalWidth, Math.max(480, image.naturalWidth * 0.38));
  let cropHeight = cropWidth / cropAspect;
  if (cropHeight > image.naturalHeight) {
    cropHeight = image.naturalHeight;
    cropWidth = cropHeight * cropAspect;
  }
  const sourceX = clamp(
    center.x * image.naturalWidth - cropWidth / 2,
    0,
    image.naturalWidth - cropWidth,
  );
  const sourceY = clamp(
    center.y * image.naturalHeight - cropHeight / 2,
    0,
    image.naturalHeight - cropHeight,
  );
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  );
  const translated = translateAnchorToCrop(anchor, sourceX, sourceY, cropWidth, cropHeight, image);
  drawMarker(context, translated, label, destination);
}

function drawMarker(
  context: CanvasRenderingContext2D,
  anchor: SelectionAnchor,
  label: string,
  region: DrawRegion,
): void {
  const x = region.x + anchor.x * region.width;
  const y = region.y + anchor.y * region.height;
  context.save();
  context.strokeStyle = MARKER_COLOR;
  context.fillStyle = MARKER_COLOR;
  context.lineWidth = 4;
  context.shadowColor = "rgba(0, 0, 0, 0.38)";
  context.shadowBlur = 4;
  if (anchor.kind === "point") {
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "white";
    context.lineWidth = 3;
    context.stroke();
  } else {
    context.strokeRect(x, y, anchor.width * region.width, anchor.height * region.height);
  }
  context.shadowColor = "transparent";
  drawLabel(context, label, x, y);
  context.restore();
}

function drawLabel(context: CanvasRenderingContext2D, label: string, x: number, y: number): void {
  context.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  const width = Math.ceil(context.measureText(label).width) + 14;
  const height = 24;
  const labelX = clamp(x + 10, 2, Math.max(2, context.canvas.width - width - 2));
  const above = y - height - 10;
  const labelY =
    above >= 2 ? above : clamp(y + 10, 2, Math.max(2, context.canvas.height - height - 2));
  context.fillStyle = MARKER_COLOR;
  roundRect(context, labelX, labelY, width, height, 6);
  context.fill();
  context.fillStyle = "white";
  context.textBaseline = "middle";
  context.fillText(label, labelX + 7, labelY + height / 2);
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

export function anchorForDetail(anchor: SelectionAnchor, bounds?: DomHintBounds): SelectionAnchor {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return anchor.kind === "point"
      ? { kind: "point", x: 0.5, y: 0.5 }
      : { kind: "rect", x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
  }
  if (anchor.kind === "point") {
    return {
      kind: "point",
      x: clamp((anchor.x - bounds.x) / bounds.width, 0, 1),
      y: clamp((anchor.y - bounds.y) / bounds.height, 0, 1),
    };
  }
  const x = clamp((anchor.x - bounds.x) / bounds.width, 0, 1);
  const y = clamp((anchor.y - bounds.y) / bounds.height, 0, 1);
  return {
    kind: "rect",
    x,
    y,
    width: clamp(anchor.width / bounds.width, 0, 1 - x),
    height: clamp(anchor.height / bounds.height, 0, 1 - y),
  };
}

function translateAnchorToCrop(
  anchor: SelectionAnchor,
  sourceX: number,
  sourceY: number,
  cropWidth: number,
  cropHeight: number,
  image: HTMLImageElement,
): SelectionAnchor {
  const x = clamp((anchor.x * image.naturalWidth - sourceX) / cropWidth, 0, 1);
  const y = clamp((anchor.y * image.naturalHeight - sourceY) / cropHeight, 0, 1);
  if (anchor.kind === "point") return { kind: "point", x, y };
  return {
    kind: "rect",
    x,
    y,
    width: clamp((anchor.width * image.naturalWidth) / cropWidth, 0, 1 - x),
    height: clamp((anchor.height * image.naturalHeight) / cropHeight, 0, 1 - y),
  };
}

export function detailCaptureElement(element: Element, output: HTMLElement): HTMLElement {
  let current: Element = element;
  let candidate = element instanceof HTMLElement ? element : output;
  while (current !== output) {
    if (current instanceof HTMLElement) {
      candidate = current;
      const rect = current.getBoundingClientRect();
      if (rect.width >= 240 && rect.height >= 120) return current;
    }
    const parent = parentAcrossShadow(current);
    if (!parent) break;
    if (isScrollable(parent)) return candidate;
    current = parent;
  }
  return candidate;
}

function hasScrolledAncestor(element: Element, output: HTMLElement): boolean {
  let current: Element | null = parentAcrossShadow(element);
  while (current && current !== output) {
    if (isScrollable(current) && (current.scrollTop !== 0 || current.scrollLeft !== 0)) return true;
    current = parentAcrossShadow(current);
  }
  return false;
}

function isScrollable(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
  );
}

function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function relativeElementBounds(element: Element, output: HTMLElement): DomHintBounds {
  const elementRect = element.getBoundingClientRect();
  const outputRect = output.getBoundingClientRect();
  const width = Math.max(output.scrollWidth, outputRect.width, 1);
  const height = Math.max(output.scrollHeight, outputRect.height, 1);
  const x = clamp((elementRect.left - outputRect.left + output.scrollLeft) / width, 0, 1);
  const y = clamp((elementRect.top - outputRect.top + output.scrollTop) / height, 0, 1);
  return {
    x,
    y,
    width: clamp(elementRect.width / width, 0, 1 - x),
    height: clamp(elementRect.height / height, 0, 1 - y),
  };
}

export function assertCapturableIframes(root: Element): void {
  const visit = (element: Element) => {
    if (element instanceof HTMLIFrameElement) {
      try {
        if (!element.contentDocument?.body) throw new Error("Iframe content is unavailable");
      } catch {
        throw new Error("Output contains iframe content that cannot be captured");
      }
    }
    for (const child of element.children) visit(child);
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children) visit(child);
    }
  };
  visit(root);
}

export function captureRasterSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(
    1,
    MAX_EDGE / safeWidth,
    MAX_EDGE / safeHeight,
    Math.sqrt(MAX_AREA / (safeWidth * safeHeight)),
  );
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
  };
}

export function shouldCaptureNode(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  return !node.closest("[data-marimo-lens-ui]");
}

function isLargeOutput(output: HTMLElement): boolean {
  const width = Math.max(output.scrollWidth, 1);
  const height = Math.max(output.scrollHeight, 1);
  return width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_AREA;
}

function resolveBackgroundColor(element: Element): string {
  let current: Element | null = element;
  while (current) {
    const color = getComputedStyle(current).backgroundColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    current = current.parentElement;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "#111113" : "#ffffff";
}

async function loadImage(dataUrl: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      image.src = "";
      reject(abortError());
    };
    image.addEventListener(
      "load",
      () => {
        cleanup();
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Captured image could not be decoded"));
      },
      { once: true },
    );
    signal?.addEventListener("abort", abort, { once: true });
    image.src = dataUrl;
  });
}

async function encodeWithinLimit(
  original: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  let canvas = original;
  for (;;) {
    throwIfAborted(signal);
    const blob = await canvasToPng(canvas);
    throwIfAborted(signal);
    if (blob.size <= MAX_BYTES) return { canvas, blob };
    if (Math.max(canvas.width, canvas.height) <= MIN_ENCODED_EDGE) {
      throw new Error("Captured image exceeds the 8 MiB limit");
    }
    const resized = document.createElement("canvas");
    resized.width = Math.max(1, Math.floor(canvas.width * 0.82));
    resized.height = Math.max(1, Math.floor(canvas.height * 0.82));
    const context = resized.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable");
    context.drawImage(canvas, 0, 0, resized.width, resized.height);
    canvas = resized;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Captured image could not be encoded"));
    }, "image/png");
  });
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

function abortError(): DOMException {
  return new DOMException("Lens capture was canceled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
