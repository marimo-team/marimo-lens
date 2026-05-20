import {
  closestMatching,
  classOrTag,
  dataAttributes,
  unit,
} from "@/selection/chart-units/chart-dom";
import { defineChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";
import type { ChartUnitMatch } from "@/selection/chart-units/chart-unit-adapter";
import type { LensChartPart, LensChartPartKind, LensTarget, ViewportPoint } from "@/types";

const AXIS_SELECTOR = ".role-axis,[aria-label*='axis' i]";
const LEGEND_SELECTOR = ".role-legend,[aria-label*='legend' i]";
const TITLE_SELECTOR = ".role-title,[aria-label*='title' i]";
const MARK_SELECTOR =
  ".mark-arc,.mark-area,.mark-bar,.mark-group,.mark-line,.mark-path,.mark-rect,.mark-rule,.mark-shape,.mark-symbol,.mark-text,[role='graphics-symbol']";

export const altairVegaChartUnitAdapter = defineChartUnitAdapter({
  id: "altair-vega",
  libraries: ["altair", "vega"],
  priority: 1000,
  match: ({ element, point, target }) => {
    const canvasMatch = canvasChartUnit(element, point, target);
    if (canvasMatch) return canvasMatch;

    const legend = closestMatching(element, LEGEND_SELECTOR);
    if (legend) {
      return {
        element: legend,
        unit: unit("vega", "legend", "legend", classOrTag(legend)),
        score: 94,
      };
    }

    const axis = closestMatching(element, AXIS_SELECTOR);
    if (axis) {
      return {
        element: axis,
        unit: unit("vega", "axis", axisLabel(axis), classOrTag(axis)),
        score: 92,
      };
    }

    const title = closestMatching(element, TITLE_SELECTOR);
    if (title) {
      return {
        element: title,
        unit: unit("vega", "title", "title", textLabel(title)),
        score: 90,
      };
    }

    const mark = closestMatching(element, MARK_SELECTOR);
    if (!mark) return null;
    return {
      element: mark,
      unit: unit("vega", "mark", markLabel(mark), classOrTag(mark), dataAttributes(mark)),
      score: 88,
    };
  },
});

function canvasChartUnit(
  element: Element,
  point: ViewportPoint | undefined,
  target: LensTarget | undefined,
): ChartUnitMatch | null {
  if (!point) return null;
  const canvas = closestMatching(element, "canvas.marks,canvas[aria-label*='vega' i]");
  if (!canvas) return null;
  const embed = closestMatching(canvas, ".vega-embed");
  if (!embed) return null;

  const rect = canvas.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  const x = (point.x - rect.left) / rect.width;
  const y = (point.y - rect.top) / rect.height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;

  if (y > 0.84) return canvasMatch(canvas, target, "axis", "x axis", "canvas bottom");
  if (x < 0.18) return canvasMatch(canvas, target, "axis", "y axis", "canvas left");
  if (x > 0.78 && chartHasUnit(target, "legend")) {
    return canvasMatch(canvas, target, "legend", "legend", "canvas right");
  }
  if (x >= 0.18 && y <= 0.84) {
    return canvasMatch(canvas, target, "mark", "mark", "canvas plot area");
  }
  return canvasMatch(canvas, target, "plot-area", "plot area", "canvas");
}

function canvasMatch(
  element: Element,
  target: LensTarget | undefined,
  kind: LensChartPartKind,
  fallbackLabel: string,
  fallbackDetail: string,
): ChartUnitMatch {
  const metadata = metadataPart(target, kind, fallbackLabel);
  const library = chartLibrary(target);
  return {
    element,
    unit: unit(library, kind, metadata?.label ?? fallbackLabel, metadata?.detail ?? fallbackDetail),
    score: kind === "mark" ? 89 : 91,
    context: {
      chartRenderer: "vega-canvas",
    },
  };
}

function metadataPart(
  target: LensTarget | undefined,
  kind: LensChartPartKind,
  preferredLabel: string,
): Pick<LensChartPart, "detail" | "kind" | "label"> | null {
  const units = target?.chart?.parts ?? [];
  const preferred = preferredLabel.toLowerCase();
  return (
    units.find((item) => {
      const detail = String(item.detail ?? "").toLowerCase();
      const label = `${item.label} ${detail}`.toLowerCase();
      return (
        item.kind === kind &&
        (label.includes(preferred) || Boolean(detail && preferred.includes(detail)))
      );
    }) ??
    units.find((item) => item.kind === kind) ??
    null
  );
}

function chartHasUnit(target: LensTarget | undefined, kind: LensChartPartKind): boolean {
  return (target?.chart?.parts ?? []).some((item) => item.kind === kind);
}

function chartLibrary(target: LensTarget | undefined): LensChartPart["library"] {
  const library = target?.chart?.library;
  return library === "altair" || library === "vega" ? library : "vega";
}

function axisLabel(element: Element): string {
  const orientation = axisOrientation(element);
  if (orientation) return `${orientation} axis`;
  return "axis";
}

function axisOrientation(element: Element): "x" | "y" | null {
  const semanticText = [
    element.id,
    [...element.classList].join(" "),
    element.getAttribute("aria-label"),
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(x|bottom)-?axis\b|\baxis-?x\b/.test(semanticText)) return "x";
  if (/\b(y|left)-?axis\b|\baxis-?y\b/.test(semanticText)) return "y";

  const svg = element.closest("svg");
  if (!svg) return null;
  const axisRect = element.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (axisRect.width < 2 || axisRect.height < 2 || svgRect.width < 2 || svgRect.height < 2) {
    return null;
  }
  const centerX = axisRect.left + axisRect.width / 2;
  const centerY = axisRect.top + axisRect.height / 2;
  if (centerY > svgRect.top + svgRect.height * 0.72) return "x";
  if (centerX < svgRect.left + svgRect.width * 0.28) return "y";
  return null;
}

function markLabel(element: Element): string {
  for (const className of element.classList) {
    if (className.startsWith("mark-")) return className.replace("mark-", "");
  }
  return "mark";
}

function textLabel(element: Element): string {
  return element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || classOrTag(element);
}
