import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

import { ownerWindow } from "./owner-realm";

export type OutputContentMetrics = {
  bounds: DOMRect;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
  scaleX: number;
  scaleY: number;
};

export function outputContentMetrics(output: HTMLElement): OutputContentMetrics {
  const bounds = output.getBoundingClientRect();
  const viewportWidth = output.offsetWidth > 0 ? output.offsetWidth : Math.max(bounds.width, 1);
  const viewportHeight = output.offsetHeight > 0 ? output.offsetHeight : Math.max(bounds.height, 1);
  return {
    bounds,
    width: Math.max(output.scrollWidth, viewportWidth, 1),
    height: Math.max(output.scrollHeight, viewportHeight, 1),
    scrollLeft: output.scrollLeft,
    scrollTop: output.scrollTop,
    scaleX: bounds.width > 0 ? bounds.width / viewportWidth : 1,
    scaleY: bounds.height > 0 ? bounds.height / viewportHeight : 1,
  };
}

/** The source content box in another output's unscaled content coordinates. */
export function contentBoundsInOutput(source: OutputContentMetrics, target: OutputContentMetrics) {
  const scaleX = source.scaleX / target.scaleX;
  const scaleY = source.scaleY / target.scaleY;
  return {
    x:
      (source.bounds.left - target.bounds.left) / target.scaleX +
      target.scrollLeft -
      source.scrollLeft * scaleX,
    y:
      (source.bounds.top - target.bounds.top) / target.scaleY +
      target.scrollTop -
      source.scrollTop * scaleY,
    width: source.width * scaleX,
    height: source.height * scaleY,
  };
}

export function anchorCenter(anchor: SelectionAnchor) {
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y };
  return { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
}

export function relativeOutputBounds(element: Element, output: HTMLElement): DomHintBounds {
  const elementRect = element.getBoundingClientRect();
  const outputMetrics = outputContentMetrics(output);
  const x = clamp(
    ((elementRect.left - outputMetrics.bounds.left) / outputMetrics.scaleX +
      outputMetrics.scrollLeft) /
      outputMetrics.width,
    0,
    1,
  );
  const y = clamp(
    ((elementRect.top - outputMetrics.bounds.top) / outputMetrics.scaleY +
      outputMetrics.scrollTop) /
      outputMetrics.height,
    0,
    1,
  );
  return {
    x,
    y,
    width: clamp(elementRect.width / outputMetrics.scaleX / outputMetrics.width, 0, 1 - x),
    height: clamp(elementRect.height / outputMetrics.scaleY / outputMetrics.height, 0, 1 - y),
  };
}

export function parentElementAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ownerWindow(element.ownerDocument).ShadowRoot ? root.host : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
