import type { RectAnchor, SelectionAnchor } from "@marimo-lens/protocol";

import { outputContentMetrics } from "@marimo-lens/image-capture";

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

export function anchorToViewport(
  output: HTMLElement,
  anchor: SelectionAnchor,
  attachment?: ScrollAttachment,
): ViewportAnchor {
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
    current = parentElementAcrossShadow(current);
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

function parentElementAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  const ownerWindow = element.ownerDocument.defaultView;
  return ownerWindow && root instanceof ownerWindow.ShadowRoot ? root.host : null;
}
