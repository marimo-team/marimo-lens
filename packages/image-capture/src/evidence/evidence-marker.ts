import type { SelectionAnchor } from "@marimo-lens/protocol";

import { clamp, type DrawRegion } from "./geometry";

const MARKER_COLOR = "#0880ea";
const MARKER_LABEL_COLOR = "rgba(8, 128, 234, 0.82)";
const MARKER_LABEL_EDGE_GAP = 2;

export function drawMarker(
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
  context.beginPath();
  context.roundRect(position.x, position.y, width, height, 6);
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
