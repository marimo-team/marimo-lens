import type { LensChartPart } from "@/types";

import { ancestryCrossingShadow, closestCrossingShadow } from "@/lib/shadow-dom";

export function closestMatching(element: Element, selectors: string): Element | null {
  for (const candidate of ancestryCrossingShadow(element)) {
    try {
      if (candidate.matches(selectors)) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

export function closestVisualSurface(element: Element): Element | null {
  return closestCrossingShadow(element, "svg,canvas,.vega-embed,.plotly,.js-plotly-plot");
}

export function chartLabel(element: Element, fallback: string): string {
  const aria = element.getAttribute("aria-label");
  const title = element.querySelector("title")?.textContent;
  const text = element.textContent?.trim().replace(/\s+/g, " ");
  return firstUseful([aria, title, text, fallback], fallback);
}

export function classOrTag(element: Element): string {
  for (const className of element.classList) {
    if (className) return `.${className}`;
  }
  const id = element.getAttribute("id");
  if (id) return `#${id}`;
  return element.tagName.toLowerCase();
}

export function dataAttributes(element: Element): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const attribute of element.getAttributeNames()) {
    if (!attribute.startsWith("data-")) continue;
    data[attribute.slice("data-".length)] = element.getAttribute(attribute);
  }
  return data;
}

export function isSvgTextElement(element: Element): boolean {
  return element.tagName.toLowerCase() === "text" || closestMatching(element, "text") !== null;
}

export function part(
  library: LensChartPart["library"],
  kind: LensChartPart["kind"],
  label: string,
  detail?: string,
  datum?: Record<string, unknown>,
): LensChartPart {
  return {
    library,
    kind,
    label: label.trim(),
    ...(detail ? { detail: detail.trim() } : {}),
    ...(datum && Object.keys(datum).length > 0 ? { datum } : {}),
  };
}

function firstUseful(values: Array<string | null | undefined>, fallback: string): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return fallback;
}
