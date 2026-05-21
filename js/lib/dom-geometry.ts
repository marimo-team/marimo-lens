export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createDomRect(x: number, y: number, width: number, height: number): DOMRect {
  if (typeof DOMRect !== "undefined") return new DOMRect(x, y, width, height);
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({ x, y, width, height }),
  } as DOMRect;
}
