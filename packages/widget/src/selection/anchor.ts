import type { RectAnchor, SelectionAnchor } from "@marimo-lens/protocol";

import { outputContentMetrics, relativeOutputBounds } from "@marimo-lens/image-capture";

import { composedParent } from "@/notebook/open-tree";

import { resolveFrame } from "./anchor-frame";

export type ViewportAnchor =
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number };

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

type ScrollFrame = {
  element: HTMLElement;
  scrollLeft: number;
  scrollTop: number;
};

export type ScrollAttachment = {
  frames: ScrollFrame[];
  ancestorBaselines: ScrollFrame[];
};

/**
 * Place an anchor in the viewport. An anchor on a frame, such as a chart's
 * canvas, follows that element wherever the output's layout moves or resizes
 * it. Other anchors keep their place in the output's content.
 */
export function anchorToViewport(
  output: HTMLElement,
  anchor: SelectionAnchor,
  attachment?: ScrollAttachment,
): ViewportAnchor {
  const framed = framedRect(output, anchor);
  if (framed) return onFrame(anchor, framed.rect);
  const metrics = outputContentMetrics(output);
  const nestedScroll = attachmentOffset(attachment);
  const x =
    metrics.bounds.left +
    (anchor.x * metrics.width - metrics.scrollLeft) * metrics.scaleX -
    nestedScroll.x;
  const y =
    metrics.bounds.top +
    (anchor.y * metrics.height - metrics.scrollTop) * metrics.scaleY -
    nestedScroll.y;
  if (anchor.kind === "point") return { kind: "point", x, y };
  return {
    kind: "rect",
    x,
    y,
    width: anchor.width * metrics.width * metrics.scaleX,
    height: anchor.height * metrics.height * metrics.scaleY,
  };
}

/** The viewport point at the center of an anchor. */
export function anchorCenter(
  output: HTMLElement,
  anchor: SelectionAnchor,
): { x: number; y: number } {
  const viewport = anchorToViewport(output, anchor);
  return viewport.kind === "point"
    ? viewport
    : { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

/**
 * Restate an anchor in the output's current layout, so moving or resizing it
 * starts from where its marker shows now.
 */
export function currentAnchor(output: HTMLElement, anchor: SelectionAnchor): SelectionAnchor {
  const framed = framedRect(output, anchor);
  if (!anchor.frame || !framed) return anchor;
  const viewport = onFrame(anchor, framed.rect);
  const frame = { path: anchor.frame.path, bounds: relativeOutputBounds(framed.element, output) };
  const start = viewportToContent(output, viewport.x, viewport.y);
  if (viewport.kind === "point") return { kind: "point", ...start, frame };
  const end = viewportToContent(output, viewport.x + viewport.width, viewport.y + viewport.height);
  const width = end.x - start.x;
  const height = end.y - start.y;
  if (width <= 0 || height <= 0) return anchor;
  return { kind: "rect", ...start, width, height, frame };
}

/** Convert a viewport point to fractions of the output's scrollable content. */
export function viewportToContent(output: HTMLElement, x: number, y: number) {
  const metrics = outputContentMetrics(output);
  return {
    x: clamp(
      ((x - metrics.bounds.left) / metrics.scaleX + metrics.scrollLeft) / metrics.width,
      0,
      1,
    ),
    y: clamp(
      ((y - metrics.bounds.top) / metrics.scaleY + metrics.scrollTop) / metrics.height,
      0,
      1,
    ),
  };
}

function framedRect(
  output: HTMLElement,
  anchor: SelectionAnchor,
): { element: Element; rect: DOMRect } | null {
  const frame = anchor.frame;
  if (!frame || frame.bounds.width <= 0 || frame.bounds.height <= 0) return null;
  const element = resolveFrame(output, frame.path);
  const rect = element?.getBoundingClientRect();
  return element && rect && rect.width > 0 && rect.height > 0 ? { element, rect } : null;
}

function onFrame(anchor: SelectionAnchor, rect: DOMRect): ViewportAnchor {
  const bounds = anchor.frame!.bounds;
  const x = rect.left + ((anchor.x - bounds.x) / bounds.width) * rect.width;
  const y = rect.top + ((anchor.y - bounds.y) / bounds.height) * rect.height;
  if (anchor.kind === "point") return { kind: "point", x, y };
  return {
    kind: "rect",
    x,
    y,
    width: (anchor.width / bounds.width) * rect.width,
    height: (anchor.height / bounds.height) * rect.height,
  };
}

export function isViewportAnchorInsideOutput(
  output: HTMLElement,
  viewport: ViewportAnchor,
  attachment?: ScrollAttachment,
): boolean {
  const clipBounds = [
    output.getBoundingClientRect(),
    ...(attachment?.frames.map(({ element }) => element.getBoundingClientRect()) ?? []),
  ];
  if (viewport.kind === "point") {
    return clipBounds.every(
      (bounds) =>
        viewport.x >= bounds.left &&
        viewport.x <= bounds.right &&
        viewport.y >= bounds.top &&
        viewport.y <= bounds.bottom,
    );
  }
  return clipBounds.every(
    (bounds) =>
      viewport.x >= bounds.left &&
      viewport.y >= bounds.top &&
      viewport.x + viewport.width <= bounds.right &&
      viewport.y + viewport.height <= bounds.bottom,
  );
}

export function attachToNestedScroll(
  output: HTMLElement,
  element: Element,
  previous?: ScrollAttachment,
): ScrollAttachment {
  const frames: ScrollFrame[] = [];
  const ancestorBaselines: ScrollFrame[] = [];
  const previousBaselines = new Map(
    previous?.ancestorBaselines.map((baseline) => [baseline.element, baseline]),
  );
  let current: Element | null = element;
  while (current && current !== output) {
    if (isHTMLElement(current, output.ownerDocument)) {
      const previousBaseline = previousBaselines.get(current);
      const baseline = {
        element: current,
        scrollLeft: previousBaseline?.scrollLeft ?? current.scrollLeft,
        scrollTop: previousBaseline?.scrollTop ?? current.scrollTop,
      };
      ancestorBaselines.push(baseline);
      if (isScrollFrame(current)) frames.push(baseline);
    }
    current = composedParent(current);
  }
  return current === output ? { frames, ancestorBaselines } : { frames: [], ancestorBaselines: [] };
}

export function translateAnchor(
  output: HTMLElement,
  anchor: SelectionAnchor,
  deltaX: number,
  deltaY: number,
): SelectionAnchor {
  const metrics = outputContentMetrics(output);
  const dx = deltaX / metrics.scaleX / metrics.width;
  const dy = deltaY / metrics.scaleY / metrics.height;
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
  const dx = deltaX / metrics.scaleX / metrics.width;
  const dy = deltaY / metrics.scaleY / metrics.height;
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

function attachmentOffset(attachment?: ScrollAttachment) {
  let x = 0;
  let y = 0;
  for (const frame of attachment?.frames ?? []) {
    const bounds = frame.element.getBoundingClientRect();
    const scaleX =
      frame.element.offsetWidth > 0 && bounds.width > 0
        ? bounds.width / frame.element.offsetWidth
        : 1;
    const scaleY =
      frame.element.offsetHeight > 0 && bounds.height > 0
        ? bounds.height / frame.element.offsetHeight
        : 1;
    x += (frame.element.scrollLeft - frame.scrollLeft) * scaleX;
    y += (frame.element.scrollTop - frame.scrollTop) * scaleY;
  }
  return { x, y };
}

function isHTMLElement(element: Element, ownerDocument: Document): element is HTMLElement {
  const ownerWindow = ownerDocument.defaultView;
  return ownerWindow !== null && element instanceof ownerWindow.HTMLElement;
}

function isScrollFrame(element: HTMLElement): boolean {
  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) return false;
  const style = ownerWindow.getComputedStyle(element);
  return (
    (element.scrollWidth > element.clientWidth &&
      (acceptsScroll(style.overflowX) || acceptsScroll(style.overflow))) ||
    (element.scrollHeight > element.clientHeight &&
      (acceptsScroll(style.overflowY) || acceptsScroll(style.overflow)))
  );
}

function acceptsScroll(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll";
}

export function sameAnchor(left: SelectionAnchor, right: SelectionAnchor): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
