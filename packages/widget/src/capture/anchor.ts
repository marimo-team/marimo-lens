import type { RectAnchor, SelectionAnchor } from "@/contracts";

export type ViewportAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number };

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export function anchorToViewport(output: HTMLElement, anchor: SelectionAnchor): ViewportAnchor {
  const bounds = output.getBoundingClientRect();
  const contentWidth = Math.max(output.scrollWidth, bounds.width, 1);
  const contentHeight = Math.max(output.scrollHeight, bounds.height, 1);
  const x = bounds.left + anchor.x * contentWidth - output.scrollLeft;
  const y = bounds.top + anchor.y * contentHeight - output.scrollTop;
  if (anchor.kind === "point") return { kind: "point", x, y };
  return {
    kind: "rect",
    x,
    y,
    width: anchor.width * contentWidth,
    height: anchor.height * contentHeight,
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
  const bounds = output.getBoundingClientRect();
  const contentWidth = Math.max(output.scrollWidth, bounds.width, 1);
  const contentHeight = Math.max(output.scrollHeight, bounds.height, 1);
  const dx = deltaX / contentWidth;
  const dy = deltaY / contentHeight;
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
  const bounds = output.getBoundingClientRect();
  const contentWidth = Math.max(output.scrollWidth, bounds.width, 1);
  const contentHeight = Math.max(output.scrollHeight, bounds.height, 1);
  const dx = deltaX / contentWidth;
  const dy = deltaY / contentHeight;
  let left = anchor.x;
  let right = anchor.x + anchor.width;
  let top = anchor.y;
  let bottom = anchor.y + anchor.height;
  const minimumWidth = Math.max(Number.EPSILON, 12 / contentWidth);
  const minimumHeight = Math.max(Number.EPSILON, 12 / contentHeight);

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

export function anchorCenter(anchor: SelectionAnchor): {
  x: number;
  y: number;
} {
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y };
  return { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
