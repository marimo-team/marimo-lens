import type { DomHintBounds, SelectionAnchor } from "@marimo-lens/protocol";

import { planSelectionCapture, isLargeOutput, type SelectionCaptureTarget } from "./capture-plan";
import { throwIfCaptureAborted } from "./owner-realm";
import { captureElementRaster, type RasterizeElement, resolveCaptureBackground } from "./raster";

export type SelectionEvidence = {
  anchor: SelectionAnchor;
  overview: HTMLImageElement;
  detail: { image: HTMLImageElement; bounds: DomHintBounds } | null;
  backgroundColor: string;
};

export type OutputEvidence = {
  overview: HTMLImageElement;
  detail: HTMLImageElement | null;
  backgroundColor: string;
};

export async function captureSelectionEvidence(
  options: SelectionCaptureTarget,
  signal?: AbortSignal,
  rasterize?: RasterizeElement,
): Promise<SelectionEvidence> {
  const plan = planSelectionCapture(options);
  const backgroundColor = resolveCaptureBackground(plan.overview.element);
  const detail = plan.detail
    ? {
        image: await captureElementRaster(
          plan.detail.element,
          backgroundColor,
          false,
          signal,
          rasterize,
        ),
        bounds: plan.detail.bounds,
      }
    : null;
  throwIfCaptureAborted(signal, options.output.ownerDocument);
  const overview = await captureElementRaster(
    plan.overview.element,
    backgroundColor,
    true,
    signal,
    rasterize,
    plan.overview.region,
  );
  return { overview, detail, backgroundColor, anchor: plan.anchor };
}

export async function captureOutputEvidence(
  output: HTMLElement,
  signal?: AbortSignal,
  rasterize?: RasterizeElement,
): Promise<OutputEvidence> {
  const backgroundColor = resolveCaptureBackground(output);
  const includeDetail = isLargeOutput(output) || output.scrollLeft !== 0 || output.scrollTop !== 0;
  const detail = includeDetail
    ? await captureElementRaster(output, backgroundColor, false, signal, rasterize)
    : null;
  const overview = await captureElementRaster(output, backgroundColor, true, signal, rasterize);
  return { overview, detail, backgroundColor };
}
