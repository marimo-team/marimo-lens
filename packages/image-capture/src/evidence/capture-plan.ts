import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

import type { CaptureRegion } from "./raster";

import { anchorForDetail } from "./evidence-layout";
import {
  contentBoundsInOutput,
  type OutputContentMetrics,
  outputContentMetrics,
  parentElementAcrossShadow,
  relativeOutputBounds,
} from "./geometry";
import { ownerError } from "./owner-realm";
import { exceedsCaptureDimensions } from "./png";

export type SelectionCaptureTarget = {
  output: HTMLElement;
  anchor: SelectionAnchor;
  detailElement?: Element;
  context?: "auto" | HTMLElement;
};

type DetailTarget = { element: HTMLElement; bounds: DomHintBounds };
export type SelectionCapturePlan = {
  overview: { element: HTMLElement; region?: CaptureRegion };
  detail: DetailTarget | null;
  anchor: SelectionAnchor;
};

/** Choose capture geometry before rasterization starts. */
export function planSelectionCapture(target: SelectionCaptureTarget): SelectionCapturePlan {
  const output = captureContextElement(target.output, target.context);
  if (output === target.output) {
    return {
      overview: { element: output },
      detail: selectionDetailTarget(target),
      anchor: target.anchor,
    };
  }

  const metrics = outputContentMetrics(output);
  const source = contentBoundsInOutput(outputContentMetrics(target.output), metrics);
  const { anchor } = target;
  const region = contextCaptureRegion(metrics, {
    x: source.x + anchor.x * source.width,
    y: source.y + anchor.y * source.height,
    width: anchor.kind === "rect" ? anchor.width * source.width : 0,
    height: anchor.kind === "rect" ? anchor.height * source.height : 0,
  });
  return {
    overview: { element: output, region },
    detail: null,
    anchor: anchorForDetail(anchor, {
      x: (region.x - source.x) / source.width,
      y: (region.y - source.y) / source.height,
      width: region.width / source.width,
      height: region.height / source.height,
    }),
  };
}

function captureContextElement(output: HTMLElement, context?: "auto" | HTMLElement): HTMLElement {
  if (context === undefined) return output;
  if (context === "auto") return selectionContextElement(output);
  let ancestor: Element | null = output;
  while (ancestor && ancestor !== context) ancestor = parentElementAcrossShadow(ancestor);
  if (
    !ancestor ||
    context === output.ownerDocument.body ||
    context === output.ownerDocument.documentElement
  ) {
    throw ownerError(
      output.ownerDocument,
      "Capture context must be a bounded ancestor of its target",
    );
  }
  return context;
}

/** Include a nearby card or row for small DOM targets, never the whole page. */
function selectionContextElement(output: HTMLElement): HTMLElement {
  const bounds = output.getBoundingClientRect();
  if ((bounds.width >= 240 && bounds.height >= 120) || clipsContent(output)) return output;
  let candidate = output;
  let parent = parentElementAcrossShadow(output);
  while (
    parent &&
    parent !== output.ownerDocument.body &&
    parent !== output.ownerDocument.documentElement
  ) {
    if (
      !isHTMLElement(parent) ||
      clipsContent(parent) ||
      parent.hasAttribute("data-marimo-lens-ui")
    )
      break;
    const rect = parent.getBoundingClientRect();
    if (rect.width > 2_000 || rect.height > 720) break;
    if (rect.width >= bounds.width && rect.height >= bounds.height) {
      candidate = parent;
      if (rect.width >= 240 && rect.height >= 120) break;
    }
    parent = parentElementAcrossShadow(parent);
  }
  return candidate;
}

function contextCaptureRegion(
  metrics: OutputContentMetrics,
  attention: CaptureRegion,
): CaptureRegion {
  const preferredWidth = Math.min(640, Math.max(320, Math.min(metrics.width, metrics.height * 3)));
  const preferredHeight = Math.min(480, Math.max(120, metrics.height));
  const width = Math.max(preferredWidth, Math.min(metrics.width, attention.width + 32));
  const height = Math.max(preferredHeight, Math.min(metrics.height, attention.height + 32));
  const position = (size: number, extent: number, center: number) =>
    size > extent ? (extent - size) / 2 : Math.max(0, Math.min(center - size / 2, extent - size));
  return {
    x: position(width, metrics.width, attention.x + attention.width / 2),
    y: position(height, metrics.height, attention.y + attention.height / 2),
    width,
    height,
  };
}

function clipsContent(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return [style.overflowX, style.overflowY].some((overflow) =>
    ["auto", "scroll", "hidden", "clip"].includes(overflow),
  );
}

function detailCaptureElement(element: Element, output: HTMLElement): HTMLElement {
  let current: Element = element;
  let candidate = isHTMLElement(element) ? element : output;
  while (current !== output) {
    if (isHTMLElement(current)) {
      candidate = current;
      const rect = current.getBoundingClientRect();
      if (rect.width >= 240 && rect.height >= 120) return current;
    }
    const parent = parentElementAcrossShadow(current);
    if (!parent) break;
    if (isScrollable(parent)) return candidate;
    current = parent;
  }
  return candidate;
}

function selectionDetailTarget(options: SelectionCaptureTarget): DetailTarget | null {
  if (!options.detailElement) return null;
  const target =
    options.detailElement === options.output
      ? options.output
      : detailCaptureElement(options.detailElement, options.output);
  const needsDetail =
    target === options.output
      ? isLargeOutput(options.output)
      : hasScrolledAncestor(target, options.output) || isLargeOutput(options.output);
  if (!needsDetail) return null;
  return {
    element: target,
    bounds: relativeOutputBounds(target, options.output),
  };
}

function hasScrolledAncestor(element: Element, output: HTMLElement): boolean {
  let current: Element | null = parentElementAcrossShadow(element);
  while (current && current !== output) {
    if (isScrollable(current) && (current.scrollTop !== 0 || current.scrollLeft !== 0)) return true;
    current = parentElementAcrossShadow(current);
  }
  return false;
}

export function isLargeOutput(output: HTMLElement): boolean {
  const metrics = outputContentMetrics(output);
  return exceedsCaptureDimensions(metrics.width, metrics.height);
}

function isScrollable(element: Element): element is HTMLElement {
  return (
    isHTMLElement(element) &&
    (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
  );
}

function isHTMLElement(element: Element): element is HTMLElement {
  const window = element.ownerDocument.defaultView;
  return window !== null && element instanceof window.HTMLElement;
}
