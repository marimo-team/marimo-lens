import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

import { anchorCenter } from "./geometry";
import { ownerError } from "./owner-realm";
import { captureRasterSize, exceedsCaptureDimensions, MAX_CAPTURE_EDGE } from "./png";

const COMPOSITE_GAP = 20;
const COMPOSITE_PADDING = 24;
const MARKER_COLOR = "#0880ea";
const MARKER_LABEL_COLOR = "rgba(8, 128, 234, 0.82)";
const MARKER_LABEL_EDGE_GAP = 2;

type DrawRegion = { x: number; y: number; width: number; height: number };
type RoundedPathContext = Omit<CanvasRenderingContext2D, "roundRect"> & {
  roundRect?: CanvasRenderingContext2D["roundRect"];
};

export type EvidenceLayout = {
  width: number;
  height: number;
  overview: DrawRegion;
  detail?: DrawRegion;
};

export function composeSelectionEvidence(options: {
  ownerDocument: Document;
  overview: HTMLImageElement;
  detail: { image: HTMLImageElement; bounds: DomHintBounds } | null;
  backgroundColor: string;
  anchor: SelectionAnchor;
  label: string;
}): HTMLCanvasElement {
  const layout = evidenceLayout(
    options.overview.naturalWidth,
    options.overview.naturalHeight,
    options.detail !== null,
  );
  const { canvas, context } = evidenceCanvas(
    options.ownerDocument,
    layout,
    options.backgroundColor,
  );
  const overviewRegion = drawContained(context, options.overview, layout.overview);
  // The detail raster owns the marker when present because it preserves the
  // live scroll position used when the selection was created.
  if (!layout.detail) drawMarker(context, options.anchor, options.label, overviewRegion);

  if (layout.detail) {
    drawEvidenceDivider(context, layout.detail);
    if (options.detail) {
      const detailRegion = drawContained(context, options.detail.image, layout.detail);
      drawMarker(
        context,
        anchorForDetail(options.anchor, options.detail.bounds),
        options.label,
        detailRegion,
      );
    } else {
      drawCroppedDetail(context, options.overview, options.anchor, options.label, layout.detail);
    }
  }
  return canvas;
}

export function composeOutputEvidence(options: {
  ownerDocument: Document;
  overview: HTMLImageElement;
  detail: HTMLImageElement | null;
  backgroundColor: string;
}): HTMLCanvasElement {
  const layout = evidenceLayout(
    options.overview.naturalWidth,
    options.overview.naturalHeight,
    options.detail !== null,
  );
  const { canvas, context } = evidenceCanvas(
    options.ownerDocument,
    layout,
    options.backgroundColor,
  );
  drawContained(context, options.overview, layout.overview);
  if (options.detail && layout.detail) {
    drawEvidenceDivider(context, layout.detail);
    drawContained(context, options.detail, layout.detail);
  }
  return canvas;
}

export function evidenceLayout(
  sourceWidth: number,
  sourceHeight: number,
  includeDetail: boolean,
): EvidenceLayout {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  if (!includeDetail && !exceedsCaptureDimensions(safeWidth, safeHeight)) {
    const size = captureRasterSize(safeWidth, safeHeight);
    return {
      width: size.width,
      height: size.height,
      overview: { x: 0, y: 0, width: size.width, height: size.height },
    };
  }

  const width = Math.min(MAX_CAPTURE_EDGE, Math.max(800, safeWidth));
  const contentWidth = width - COMPOSITE_PADDING * 2;
  const overviewHeight = Math.min(1_080, Math.max(360, (safeHeight / safeWidth) * contentWidth));
  const detailHeight = Math.min(
    760,
    MAX_CAPTURE_EDGE - overviewHeight - COMPOSITE_GAP - COMPOSITE_PADDING * 2,
  );
  const height = Math.round(
    Math.min(
      MAX_CAPTURE_EDGE,
      COMPOSITE_PADDING * 2 + overviewHeight + COMPOSITE_GAP + detailHeight,
    ),
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

function evidenceCanvas(ownerDocument: Document, layout: EvidenceLayout, backgroundColor: string) {
  const canvas = ownerDocument.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) throw ownerError(ownerDocument, "Canvas rendering is unavailable");
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function drawEvidenceDivider(context: CanvasRenderingContext2D, detail: DrawRegion): void {
  context.fillStyle = "rgba(127, 127, 127, 0.24)";
  context.fillRect(detail.x, detail.y - COMPOSITE_GAP / 2 - 0.5, detail.width, 1);
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
  drawMarker(
    context,
    translateAnchorToCrop(anchor, sourceX, sourceY, cropWidth, cropHeight, image),
    label,
    destination,
  );
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
  drawLabel(
    context,
    label,
    x,
    y,
    anchor.kind === "rect"
      ? {
          x,
          y,
          width: anchor.width * region.width,
          height: anchor.height * region.height,
        }
      : null,
  );
  context.restore();
}

function drawLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  selection: DrawRegion | null,
): void {
  context.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  const width = Math.ceil(context.measureText(label).width) + 14;
  const height = 24;
  const position = labelPosition(context.canvas, width, height, x, y, selection);
  context.fillStyle = MARKER_LABEL_COLOR;
  roundRect(context, position.x, position.y, width, height, 6);
  context.fill();
  context.fillStyle = "white";
  context.textBaseline = "middle";
  context.fillText(label, position.x + 7, position.y + height / 2);
}

function labelPosition(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  x: number,
  y: number,
  selection: DrawRegion | null,
) {
  const inset = selection ? 0 : 2;
  const maxX = Math.max(inset, canvas.width - width - inset);
  const maxY = Math.max(inset, canvas.height - height - inset);
  const alignedX = clamp(selection?.x ?? x + 10, inset, maxX);
  const above = selection ? selection.y - height : y - height - 10;
  if (above >= inset) return { x: alignedX, y: above };

  if (selection) {
    const left = selection.x - width - MARKER_LABEL_EDGE_GAP;
    if (left >= inset) return { x: left, y: clamp(selection.y, inset, maxY) };
    const right = selection.x + selection.width + MARKER_LABEL_EDGE_GAP;
    if (right + width <= canvas.width - inset) {
      return { x: right, y: clamp(selection.y, inset, maxY) };
    }
    const below = selection.y + selection.height + MARKER_LABEL_EDGE_GAP;
    if (below + height <= canvas.height - inset) return { x: alignedX, y: below };
  }

  return { x: alignedX, y: clamp(y + 10, inset, maxY) };
}

function roundRect(
  context: RoundedPathContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (context.roundRect) {
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
