import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

export type OutputContentMetrics = {
  bounds: DOMRect;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
};

export function outputContentMetrics(output: HTMLElement): OutputContentMetrics {
  const bounds = output.getBoundingClientRect();
  return {
    bounds,
    width: Math.max(output.scrollWidth, bounds.width, 1),
    height: Math.max(output.scrollHeight, bounds.height, 1),
    scrollLeft: output.scrollLeft,
    scrollTop: output.scrollTop,
  };
}

export function anchorCenter(anchor: SelectionAnchor): { x: number; y: number } {
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y };
  return { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
}

export function relativeOutputBounds(element: Element, output: HTMLElement): DomHintBounds {
  const elementRect = element.getBoundingClientRect();
  const outputMetrics = outputContentMetrics(output);
  const x = clamp(
    (elementRect.left - outputMetrics.bounds.left + outputMetrics.scrollLeft) / outputMetrics.width,
    0,
    1,
  );
  const y = clamp(
    (elementRect.top - outputMetrics.bounds.top + outputMetrics.scrollTop) / outputMetrics.height,
    0,
    1,
  );
  return {
    x,
    y,
    width: clamp(elementRect.width / outputMetrics.width, 0, 1 - x),
    height: clamp(elementRect.height / outputMetrics.height, 0, 1 - y),
  };
}

export function parentElementAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root.nodeType === 11 && "host" in root ? (root as ShadowRoot).host : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
