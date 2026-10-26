import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

import { drawMarker } from "./evidence-marker";
import { anchorCenter, anchorForDetail, clamp, type DrawRegion } from "./geometry";
import { ownerError } from "./owner-realm";
import { captureRasterSize, exceedsCaptureDimensions, MAX_CAPTURE_EDGE } from "./png";

const COMPOSITE_GAP = 20;
const COMPOSITE_PADDING = 24;

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

function translateAnchorToCrop(
  anchor: SelectionAnchor,
  sourceX: number,
  sourceY: number,
  cropWidth: number,
  cropHeight: number,
  image: HTMLImageElement,
): SelectionAnchor {
  return anchorForDetail(anchor, {
    x: sourceX / image.naturalWidth,
    y: sourceY / image.naturalHeight,
    width: cropWidth / image.naturalWidth,
    height: cropHeight / image.naturalHeight,
  });
}
