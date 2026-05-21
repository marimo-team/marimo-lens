import { createDomRect } from "@/lib/dom-geometry";
import { closestCrossingShadow } from "@/lib/shadow-dom";

const MIN_COLUMN_WIDTH = 16;
const ROW_MARKER_MAX_WIDTH = 56;
const EDGE_CONTRAST_THRESHOLD = 18;
const MAX_SUBTLE_EDGE_LUMINANCE_DELTA = 38;
const MIN_SUBTLE_EDGE_LUMINANCE_DELTA = 6;

export function gridCanvasElement(element: Element): HTMLCanvasElement | null {
  if (
    element instanceof HTMLCanvasElement &&
    element.matches("canvas[data-testid='data-grid-canvas']")
  ) {
    return element;
  }
  if (element instanceof HTMLCanvasElement && element.matches("canvas")) return element;

  const host = closestCrossingShadow(element, "marimo-data-editor");
  const root = host instanceof HTMLElement ? host.shadowRoot : null;
  const canvas =
    root?.querySelector("canvas[data-testid='data-grid-canvas']") ??
    (element instanceof HTMLElement
      ? element.shadowRoot?.querySelector("canvas[data-testid='data-grid-canvas'],canvas")
      : null);
  return canvas instanceof HTMLCanvasElement ? canvas : null;
}

export function canvasGridColumnRects(element: Element, columnCount: number): DOMRect[] {
  const canvas = gridCanvasElement(element);
  if (!canvas || columnCount <= 0) return [];

  const measured = measuredColumnRects(canvas, columnCount);
  if (measured.length > 0) return measured;

  return [];
}

function measuredColumnRects(canvas: HTMLCanvasElement, columnCount: number): DOMRect[] {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return [];

  const boundaries = detectedColumnBoundaries(canvas, columnCount);
  if (boundaries.length !== columnCount + 1) return [];

  return boundaries.slice(0, columnCount).map((left, index) => {
    const right = boundaries[index + 1];
    return createDomRect(rect.left + left, rect.top, right - left, rect.height);
  });
}

function detectedColumnBoundaries(canvas: HTMLCanvasElement, columnCount: number): number[] {
  const context = readableCanvasContext(canvas);
  if (!context) return [];

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return [];
  }

  const sampleYs = sampleRows(rect.height);
  const hitXs: number[] = [];
  for (let cssX = 1; cssX < Math.floor(rect.width) - 1; cssX += 1) {
    let hits = 0;
    for (const cssY of sampleYs) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.round(cssX * scaleX)));
      const y = Math.min(canvas.height - 1, Math.max(0, Math.round(cssY * scaleY)));
      const center = pixelAt(context, x, y);
      const left = pixelAt(context, Math.max(0, x - Math.max(1, Math.round(scaleX))), y);
      const right = pixelAt(
        context,
        Math.min(canvas.width - 1, x + Math.max(1, Math.round(scaleX))),
        y,
      );
      if (isSubtleGridEdge(center, left, right)) hits += 1;
    }
    if (hits >= Math.max(3, Math.ceil(sampleYs.length * 0.8))) hitXs.push(cssX);
  }

  const boundaries = groupedCenters(hitXs)
    .filter((x) => x >= 0 && x <= rect.width)
    .sort((a, b) => a - b);
  return chooseColumnBoundaries(boundaries, columnCount);
}

function readableCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("jsdom") &&
    !Object.prototype.hasOwnProperty.call(canvas, "getContext")
  ) {
    return null;
  }
  try {
    return canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    return null;
  }
}

function sampleRows(height: number): number[] {
  const samples = [0.09, 0.26, 0.42, 0.58, 0.74, 0.9]
    .map((ratio) => Math.round(height * ratio))
    .filter((y) => y > 1 && y < height - 2);
  return [...new Set(samples)];
}

function pixelAt(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): [number, number, number] {
  const data = context.getImageData(x, y, 1, 1).data;
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

function isSubtleGridEdge(
  center: [number, number, number],
  left: [number, number, number],
  right: [number, number, number],
): boolean {
  const neighbor: [number, number, number] = [
    (left[0] + right[0]) / 2,
    (left[1] + right[1]) / 2,
    (left[2] + right[2]) / 2,
  ];
  const luminanceDelta = Math.abs(luminance(center) - luminance(neighbor));
  return (
    colorDistance(center, neighbor) >= EDGE_CONTRAST_THRESHOLD &&
    luminanceDelta >= MIN_SUBTLE_EDGE_LUMINANCE_DELTA &&
    luminanceDelta <= MAX_SUBTLE_EDGE_LUMINANCE_DELTA
  );
}

function colorDistance(left: [number, number, number], right: [number, number, number]): number {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]);
}

function luminance([red, green, blue]: [number, number, number]): number {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function groupedCenters(values: number[]): number[] {
  const groups: Array<{ start: number; end: number }> = [];
  for (const value of values) {
    const previous = groups[groups.length - 1];
    if (previous && value <= previous.end + 1) {
      previous.end = value;
    } else {
      groups.push({ start: value, end: value });
    }
  }
  return groups.map((group) => (group.start + group.end) / 2);
}

function chooseColumnBoundaries(boundaries: number[], columnCount: number): number[] {
  if (boundaries.length === columnCount) return [0, ...boundaries];
  let chosen = [...boundaries];
  while (
    chosen.length > columnCount + 1 &&
    chosen[1] !== undefined &&
    chosen[1] - chosen[0] < ROW_MARKER_MAX_WIDTH
  ) {
    chosen = chosen.slice(1);
  }
  if (chosen.length > columnCount + 1) chosen = chosen.slice(0, columnCount + 1);
  if (chosen.length !== columnCount + 1) return [];

  const widths = chosen.slice(0, -1).map((left, index) => chosen[index + 1] - left);
  return widths.every((width) => width >= MIN_COLUMN_WIDTH) ? chosen : [];
}
