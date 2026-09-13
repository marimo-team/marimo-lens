import { toPng } from "html-to-image";

import { outputContentMetrics, parentElementAcrossShadow } from "./geometry";
import { ownerError, ownerWindow, throwIfCaptureAborted } from "./owner-realm";
import { captureRasterSize } from "./png";

const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";
const HIDE_SCROLLBARS = `
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; }
`;
const CAPTURE_STYLE_PROPERTIES = [
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "box-sizing",
  "aspect-ratio",
  "display",
  "position",
  "top",
  "left",
  "bottom",
  "right",
  "z-index",
  "float",
  "clear",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "align-content",
  "justify-content",
  "justify-items",
  "justify-self",
  "gap",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-template-areas",
  "grid-auto-flow",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  "row-gap",
  "column-gap",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "text-indent",
  "text-shadow",
  "white-space",
  "text-wrap",
  "word-break",
  "text-overflow",
  "vertical-align",
  "color",
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-clip",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "outline",
  "box-shadow",
  "opacity",
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "transform",
  "transform-origin",
  "transform-box",
  "clip-path",
  "overflow",
  "overflow-x",
  "overflow-y",
  "visibility",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "vector-effect",
  "paint-order",
  "text-anchor",
  "dominant-baseline",
  "stop-color",
  "stop-opacity",
  "marker-start",
  "marker-mid",
  "marker-end",
  "object-fit",
  "object-position",
  "list-style",
  "list-style-type",
  "border-collapse",
  "border-spacing",
  "content",
  "cursor",
] as const;

export type ElementCaptureGeometry = {
  width: number;
  height: number;
  style: Record<string, string>;
};

export type RasterizeElement = typeof toPng;

export type CaptureRegion = { x: number; y: number; width: number; height: number };

export async function captureElementRaster(
  element: HTMLElement,
  backgroundColor: string,
  captureFullOutput: boolean,
  signal?: AbortSignal,
  rasterize: RasterizeElement = toPng,
  region?: CaptureRegion,
): Promise<HTMLImageElement> {
  const ownerDocument = element.ownerDocument;
  throwIfCaptureAborted(signal, ownerDocument);
  const geometry = elementCaptureGeometry(element, captureFullOutput);
  if (region) {
    geometry.style = {
      ...geometry.style,
      width: `${geometry.width}px`,
      height: `${geometry.height}px`,
      margin: "0",
      maxWidth: "none",
      position: "relative",
      inset: "auto",
      top: "0",
      left: "0",
      right: "auto",
      bottom: "auto",
      transform: `translate(${-region.x}px, ${-region.y}px)`,
      transformOrigin: "top left",
    };
    geometry.width = region.width;
    geometry.height = region.height;
  }
  assertCapturableIframes(element);
  const raster = captureRasterSize(geometry.width, geometry.height);
  const dataUrl = await rasterize(element, {
    backgroundColor,
    width: geometry.width,
    height: geometry.height,
    canvasWidth: raster.width,
    canvasHeight: raster.height,
    pixelRatio: 1,
    imagePlaceholder: TRANSPARENT_PIXEL,
    includeStyleProperties: [...CAPTURE_STYLE_PROPERTIES],
    extraStyleContent: HIDE_SCROLLBARS,
    filter: shouldCaptureNode,
    style: geometry.style,
  });
  throwIfCaptureAborted(signal, ownerDocument);
  assertCapturableIframes(element);
  return loadRasterImage(ownerDocument, dataUrl, signal);
}

export function elementCaptureGeometry(
  element: HTMLElement,
  captureFullOutput: boolean,
): ElementCaptureGeometry {
  const metrics = outputContentMetrics(element);
  if (captureFullOutput) {
    return {
      width: metrics.width,
      height: metrics.height,
      style: { maxHeight: "none", overflow: "visible" },
    };
  }
  const viewportWidth = Math.max(metrics.bounds.width / metrics.scaleX, 1);
  const viewportHeight = Math.max(metrics.bounds.height / metrics.scaleY, 1);
  return {
    width: viewportWidth,
    height: viewportHeight,
    style: {
      width: `${metrics.width}px`,
      height: `${metrics.height}px`,
      maxWidth: "none",
      maxHeight: "none",
      overflow: "visible",
      position: "relative",
      inset: "auto",
      top: "0",
      left: "0",
      right: "auto",
      bottom: "auto",
      transform: `translate(${-metrics.scrollLeft}px, ${-metrics.scrollTop}px)`,
      transformOrigin: "top left",
    },
  };
}

export function resolveCaptureBackground(element: Element): string {
  const window = ownerWindow(element.ownerDocument);
  let current: Element | null = element;
  while (current) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    current = parentElementAcrossShadow(current);
  }
  const darkMode = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return darkMode ? "#111113" : "#ffffff";
}

export function shouldCaptureNode(node: Node): boolean {
  const ownerDocument = node.ownerDocument;
  if (!ownerDocument || !(node instanceof ownerWindow(ownerDocument).Element)) return true;
  return !node.closest("[data-marimo-lens-ui]");
}

export function assertCapturableIframes(root: Element): void {
  const visit = (element: Element) => {
    if (isIFrameElement(element)) {
      let body: HTMLElement | null;
      try {
        body = element.contentDocument?.body ?? null;
      } catch {
        throw ownerError(
          element.ownerDocument,
          "Output contains iframe content that cannot be captured",
        );
      }
      if (!body) {
        throw ownerError(
          element.ownerDocument,
          "Output contains iframe content that cannot be captured",
        );
      }
      visit(body);
      return;
    }
    for (const child of element.children) visit(child);
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children) visit(child);
    }
  };
  visit(root);
}

async function loadRasterImage(
  ownerDocument: Document,
  dataUrl: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  throwIfCaptureAborted(signal, ownerDocument);
  return new Promise((resolve, reject) => {
    const window = ownerWindow(ownerDocument);
    const image = new window.Image();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      image.src = "";
      try {
        throwIfCaptureAborted(signal, ownerDocument);
      } catch (error) {
        reject(error);
      }
    };
    image.addEventListener(
      "load",
      () => {
        cleanup();
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        cleanup();
        reject(ownerError(ownerDocument, "Captured image could not be decoded"));
      },
      { once: true },
    );
    signal?.addEventListener("abort", abort, { once: true });
    image.src = dataUrl;
  });
}

function isIFrameElement(element: Element): element is HTMLIFrameElement {
  return element instanceof ownerWindow(element.ownerDocument).HTMLIFrameElement;
}
