import type { ViewportPoint } from "@/types";

export type SvgBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  area: number;
};

export function toBox(rect: DOMRect): SvgBox {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  const width = right - left;
  const height = bottom - top;
  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    area: Math.max(1, width * height),
  };
}

export function pointInside(rect: SvgBox, point: ViewportPoint, padding: number): boolean {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  );
}

export function boxDistance(left: SvgBox, right: SvgBox): number {
  const dx = Math.max(0, left.left - right.right, right.left - left.right);
  const dy = Math.max(0, left.top - right.bottom, right.top - left.bottom);
  return Math.hypot(dx, dy);
}

export function unionBoxes(boxes: SvgBox[]): SvgBox {
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return toBox(new DOMRect(left, top, right - left, bottom - top));
}

export function spreadBy<T extends { rect: Pick<SvgBox, "centerX" | "centerY"> }>(
  items: T[],
  key: "centerX" | "centerY",
): number {
  const values = items.map((item) => item.rect[key]);
  return Math.max(...values) - Math.min(...values);
}

export function meanBy<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((sum, item) => sum + value(item), 0) / Math.max(1, items.length);
}
