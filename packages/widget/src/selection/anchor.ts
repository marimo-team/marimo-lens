import type { RectAnchor, SelectionAnchor } from "@marimo-lens/protocol";

import { outputContentMetrics } from "@marimo-lens/image-capture";

export type ViewportAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number };

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export function anchorToViewport(output: HTMLElement, anchor: SelectionAnchor): ViewportAnchor {
  const metrics = outputContentMetrics(output);
  const x = metrics.bounds.left + anchor.x * metrics.width - metrics.scrollLeft;
  const y = metrics.bounds.top + anchor.y * metrics.height - metrics.scrollTop;
  if (anchor.kind === "point") return { kind: "point", x, y };
  return {
    kind: "rect",
    x,
    y,
    width: anchor.width * metrics.width,
    height: anchor.height * metrics.height,
  };
}

export function isAnchorInsideOutputViewport(
  output: HTMLElement,
  anchor: SelectionAnchor,
): boolean {
  const bounds = output.getBoundingClientRect();
  const viewport = anchorToViewport(output, anchor);
  if (viewport.kind === "point") {
    return (
      viewport.x >= bounds.left &&
      viewport.x <= bounds.right &&
      viewport.y >= bounds.top &&
      viewport.y <= bounds.bottom
    );
  }
  return (
    viewport.x >= bounds.left &&
    viewport.y >= bounds.top &&
    viewport.x + viewport.width <= bounds.right &&
    viewport.y + viewport.height <= bounds.bottom
  );
}

export function translateAnchor(
  output: HTMLElement,
  anchor: SelectionAnchor,
  deltaX: number,
  deltaY: number,
): SelectionAnchor {
  const metrics = outputContentMetrics(output);
  const dx = deltaX / metrics.width;
  const dy = deltaY / metrics.height;
  if (anchor.kind === "point") {
    return {
      kind: "point",
      x: clamp(anchor.x + dx, 0, 1),
      y: clamp(anchor.y + dy, 0, 1),
    };
  }
  return {
    ...anchor,
    x: clamp(anchor.x + dx, 0, 1 - anchor.width),
    y: clamp(anchor.y + dy, 0, 1 - anchor.height),
  } satisfies RectAnchor;
}

export function resizeRectAnchor(
  output: HTMLElement,
  anchor: RectAnchor,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): RectAnchor {
  const metrics = outputContentMetrics(output);
  const dx = deltaX / metrics.width;
  const dy = deltaY / metrics.height;
  let left = anchor.x;
  let right = anchor.x + anchor.width;
  let top = anchor.y;
  let bottom = anchor.y + anchor.height;
  const minimumWidth = Math.max(Number.EPSILON, 12 / metrics.width);
  const minimumHeight = Math.max(Number.EPSILON, 12 / metrics.height);

  if (handle.endsWith("w")) {
    const width = Math.min(minimumWidth, right);
    left = clamp(left + dx, 0, right - width);
  } else {
    const width = Math.min(minimumWidth, 1 - left);
    right = clamp(right + dx, left + width, 1);
  }
  if (handle.startsWith("n")) {
    const height = Math.min(minimumHeight, bottom);
    top = clamp(top + dy, 0, bottom - height);
  } else {
    const height = Math.min(minimumHeight, 1 - top);
    bottom = clamp(bottom + dy, top + height, 1);
  }

  return {
    kind: "rect",
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
