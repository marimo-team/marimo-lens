import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

import { outputContentMetrics, parentElementAcrossShadow, relativeOutputBounds } from "./geometry";
import { throwIfCaptureAborted } from "./owner-realm";
import { exceedsCaptureDimensions } from "./png";
import { captureElementRaster, resolveCaptureBackground } from "./raster";

export type SelectionCaptureOptions = {
  selectionId: string;
  label: string;
  anchor: SelectionAnchor;
  output: HTMLElement;
  detailElement?: Element;
  signal?: AbortSignal;
};

export type DetailEvidence = {
  image: HTMLImageElement;
  bounds: DomHintBounds;
};

export type SelectionEvidence = {
  overview: HTMLImageElement;
  detail: DetailEvidence | null;
  backgroundColor: string;
};

export type OutputEvidence = {
  overview: HTMLImageElement;
  detail: HTMLImageElement | null;
  backgroundColor: string;
};

type DetailTarget = {
  element: HTMLElement;
  bounds: DomHintBounds;
};

export async function captureSelectionEvidence(
  options: SelectionCaptureOptions,
  backgroundColor = resolveCaptureBackground(options.output),
): Promise<SelectionEvidence> {
  const detailTarget = selectionDetailTarget(options);
  const detail = detailTarget
    ? await captureDetailEvidence(detailTarget, backgroundColor, options.signal)
    : null;
  throwIfCaptureAborted(options.signal, options.output.ownerDocument);
  const overview = await captureElementRaster(
    options.output,
    backgroundColor,
    true,
    options.signal,
  );
  return { overview, detail, backgroundColor };
}

export async function captureOutputEvidence(
  output: HTMLElement,
  signal?: AbortSignal,
): Promise<OutputEvidence> {
  const backgroundColor = resolveCaptureBackground(output);
  const includeDetail = isLargeOutput(output) || output.scrollLeft !== 0 || output.scrollTop !== 0;
  const detail = includeDetail
    ? await captureElementRaster(output, backgroundColor, false, signal)
    : null;
  const overview = await captureElementRaster(output, backgroundColor, true, signal);
  return { overview, detail, backgroundColor };
}

export function detailCaptureElement(element: Element, output: HTMLElement): HTMLElement {
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

function selectionDetailTarget(options: SelectionCaptureOptions): DetailTarget | null {
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

async function captureDetailEvidence(
  target: DetailTarget,
  backgroundColor: string,
  signal?: AbortSignal,
): Promise<DetailEvidence> {
  return {
    image: await captureElementRaster(target.element, backgroundColor, false, signal),
    bounds: target.bounds,
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

function isLargeOutput(output: HTMLElement): boolean {
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
