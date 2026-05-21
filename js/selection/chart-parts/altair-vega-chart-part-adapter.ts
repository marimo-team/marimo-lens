import type { ChartPartMatch } from "@/selection/chart-parts/chart-part-adapter";
import type { LensChartPart, LensChartPartKind, LensTarget, ViewportPoint } from "@/types";

import { ancestryCrossingShadow } from "@/lib/shadow-dom";
import {
  closestMatching,
  classOrTag,
  dataAttributes,
  part,
} from "@/selection/chart-parts/chart-dom";
import { defineChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";

const AXIS_SELECTOR = ".role-axis,[aria-label*='axis' i]";
const FACET_SELECTOR = ".role-column-header,.role-row-header,.role-header,[aria-label*='facet' i]";
const LEGEND_SELECTOR = ".role-legend,[aria-label*='legend' i]";
const TITLE_SELECTOR = ".role-title,.role-title-text,[aria-label*='title' i]";
const MARK_SELECTOR =
  ".mark-arc,.mark-area,.mark-bar,.mark-group,.mark-line,.mark-path,.mark-rect,.mark-rule,.mark-shape,.mark-symbol,.mark-text,[role='graphics-symbol']";

export const altairVegaChartPartAdapter = defineChartPartAdapter({
  id: "altair-vega",
  libraries: ["altair", "marimo-data-explorer", "vega"],
  priority: 1000,
  match: ({ element, point, target }) => {
    const canvasMatch = canvasChartPart(element, point, target);
    if (canvasMatch) return canvasMatch;

    const legend =
      closestSemanticLayer(element, LEGEND_SELECTOR) ??
      semanticSvgElementAtPoint(element, point, LEGEND_SELECTOR);
    if (legend) {
      const metadata = metadataPart(target, "legend", "legend");
      return {
        element: legend,
        part: chartPartFromMetadata("vega", "legend", "legend", classOrTag(legend), metadata),
        score: 94,
      };
    }

    const facet =
      facetLayer(element) ??
      facetLayer(semanticSvgElementAtPoint(element, point, FACET_SELECTOR) ?? element);
    if (facet) {
      const metadata = metadataPart(
        target,
        "facet",
        `${facet.orientation} facet`,
        facet.orientation,
      );
      return {
        element: facet.element,
        part: chartPartFromMetadata(
          "vega",
          "facet",
          `${facet.orientation} facet`,
          facet.value ?? classOrTag(facet.element),
          metadata,
        ),
        score: 93,
      };
    }

    const axis =
      closestSemanticLayer(element, AXIS_SELECTOR) ??
      semanticSvgElementAtPoint(element, point, AXIS_SELECTOR);
    if (axis) {
      const label = axisLabel(axis);
      const metadata = metadataPart(target, "axis", label);
      return {
        element: axis,
        part: chartPartFromMetadata("vega", "axis", label, classOrTag(axis), metadata),
        score: 92,
      };
    }

    const title =
      closestSemanticLayer(element, TITLE_SELECTOR) ??
      semanticSvgElementAtPoint(element, point, TITLE_SELECTOR);
    if (title) {
      const label = textLabel(title);
      const metadata = metadataPart(target, "title", "title");
      return {
        element: title,
        part: chartPartFromMetadata("vega", "title", label, classOrTag(title), metadata),
        score: 90,
      };
    }

    const mark =
      closestMatching(element, MARK_SELECTOR) ??
      semanticSvgElementAtPoint(element, point, MARK_SELECTOR);
    if (!mark) return null;
    return {
      element: mark,
      part: part("vega", "mark", markLabel(mark), classOrTag(mark), dataAttributes(mark)),
      score: 88,
    };
  },
});

function canvasChartPart(
  element: Element,
  point: ViewportPoint | undefined,
  target: LensTarget | undefined,
): ChartPartMatch | null {
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
  const layout = canvasLayout(rect, target);

  if (layout.titleRect && containsPoint(layout.titleRect, point)) {
    return canvasMatch(
      canvas,
      target,
      "title",
      "title",
      "canvas title",
      layout.titleRect,
      { normalizedX: x, normalizedY: y, region: "title" },
      layout.titlePart,
    );
  }

  if (layout.columnFacetRect && containsPoint(layout.columnFacetRect, point)) {
    const panel = panelAtPoint(layout, point);
    return canvasMatch(
      canvas,
      target,
      "facet",
      "column facet",
      "canvas column facet header",
      panel.columnHeaderRect,
      {
        columnIndex: panel.columnIndex,
        columnValue: panel.columnValue,
        normalizedX: x,
        normalizedY: y,
        region: "column-facet",
      },
      layout.columnFacetPart,
    );
  }

  if (layout.bottomAxisRect && containsPoint(layout.bottomAxisRect, point)) {
    return canvasMatch(
      canvas,
      target,
      "axis",
      "x axis",
      "canvas bottom",
      layout.bottomAxisRect,
      { normalizedX: x, normalizedY: y, region: "bottom-axis" },
      metadataPart(target, "axis", "x axis"),
    );
  }

  if (layout.legendRect && containsPoint(layout.legendRect, point)) {
    return canvasMatch(
      canvas,
      target,
      "legend",
      "legend",
      "canvas right",
      layout.legendRect,
      { normalizedX: x, normalizedY: y, region: "right-legend" },
      metadataPart(target, "legend", "legend"),
    );
  }

  if (layout.rowFacetRect && containsPoint(layout.rowFacetRect, point)) {
    const panel = panelAtPoint(layout, point);
    return canvasMatch(
      canvas,
      target,
      "facet",
      "row facet",
      "canvas row facet header",
      panel.rowHeaderRect,
      {
        normalizedX: x,
        normalizedY: y,
        region: "row-facet",
        rowIndex: panel.rowIndex,
        rowValue: panel.rowValue,
      },
      layout.rowFacetPart,
    );
  }

  if (layout.leftAxisRect && containsPoint(layout.leftAxisRect, point)) {
    return canvasMatch(
      canvas,
      target,
      "axis",
      "y axis",
      "canvas left",
      layout.leftAxisRect,
      { normalizedX: x, normalizedY: y, region: "left-axis" },
      metadataPart(target, "axis", "y axis"),
    );
  }

  if (containsPoint(layout.plotRect, point)) {
    const panel = panelAtPoint(layout, point);
    return canvasMatch(
      canvas,
      target,
      "mark",
      "mark",
      "canvas facet panel",
      panel.panelRect,
      {
        columnIndex: panel.columnIndex,
        columnValue: panel.columnValue,
        normalizedX: x,
        normalizedY: y,
        region: layout.hasFacet ? "facet-panel" : "plot-area",
        rowIndex: panel.rowIndex,
        rowValue: panel.rowValue,
      },
      metadataPart(target, "mark", "mark"),
    );
  }

  return canvasMatch(canvas, target, "plot-area", "plot area", "canvas", layout.plotRect, {
    normalizedX: x,
    normalizedY: y,
    region: "canvas",
  });
}

function canvasMatch(
  element: Element,
  target: LensTarget | undefined,
  kind: LensChartPartKind,
  fallbackLabel: string,
  fallbackDetail: string,
  highlightRect: DOMRect,
  anchorData: Record<string, unknown>,
  metadata: LensChartPart | null = null,
): ChartPartMatch {
  const library = chartLibrary(target);
  return {
    element,
    part: chartPartFromMetadata(library, kind, fallbackLabel, fallbackDetail, metadata),
    score: kind === "mark" ? 89 : 91,
    highlight: {
      kind: "rect",
      rect: highlightRect,
      padding: 1,
      strategy: "chart-part-canvas-region",
    },
    anchorData,
    context: {
      chartRenderer: "vega-canvas",
      evidence: "normalized-canvas-region",
    },
  };
}

function metadataPart(
  target: LensTarget | undefined,
  kind: LensChartPartKind,
  preferredLabel: string,
  preferredChannel?: string,
): LensChartPart | null {
  const parts = target?.chart?.parts ?? [];
  const preferred = preferredLabel.toLowerCase();
  if (preferredChannel) {
    const byChannel = parts.find(
      (item) =>
        item.kind === kind &&
        (item.channel === preferredChannel || item.orientation === preferredChannel),
    );
    if (byChannel) return byChannel;
  }
  return (
    parts.find((item) => {
      const detail = String(item.detail ?? "").toLowerCase();
      const label = `${item.label} ${detail}`.toLowerCase();
      return (
        item.kind === kind &&
        (label.includes(preferred) || Boolean(detail && preferred.includes(detail)))
      );
    }) ??
    parts.find((item) => item.kind === kind) ??
    null
  );
}

type CanvasLayout = {
  bottomAxisRect: DOMRect | null;
  columnCount: number;
  columnFacetPart: LensChartPart | null;
  columnFacetRect: DOMRect | null;
  columnValues: string[];
  hasFacet: boolean;
  leftAxisRect: DOMRect | null;
  legendRect: DOMRect | null;
  plotRect: DOMRect;
  rowCount: number;
  rowFacetPart: LensChartPart | null;
  rowFacetRect: DOMRect | null;
  rowValues: string[];
  titlePart: LensChartPart | null;
  titleRect: DOMRect | null;
};

function canvasLayout(rect: DOMRect, target: LensTarget | undefined): CanvasLayout {
  const titlePart = metadataPart(target, "title", "title");
  const columnFacetPart = metadataPart(target, "facet", "column facet", "column");
  const rowFacetPart = metadataPart(target, "facet", "row facet", "row");
  const columnValues = partValues(columnFacetPart);
  const rowValues = partValues(rowFacetPart);
  const columnCount = Math.max(1, columnValues.length || partCount(columnFacetPart));
  const rowCount = Math.max(1, rowValues.length || partCount(rowFacetPart));
  const hasFacet = Boolean(columnFacetPart || rowFacetPart);
  const titleHeight = titlePart ? clamp(rect.height * 0.04, 24, 42) : 0;
  const columnFacetHeight = columnFacetPart ? clamp(rect.height * 0.02, 28, 38) : 0;
  const bottomAxisHeight = chartHasPart(target, "axis") ? clamp(rect.height * 0.035, 32, 54) : 0;
  const leftGutter = rowFacetPart
    ? clamp(rect.width * 0.16, 64, 112)
    : clamp(rect.width * 0.14, 42, 76);
  const legendWidth = chartHasPart(target, "legend") ? clamp(rect.width * 0.2, 72, 132) : 0;
  const plotLeft = rect.left + leftGutter;
  const plotTop = rect.top + titleHeight + columnFacetHeight;
  const plotRight = Math.max(plotLeft + 8, rect.right - legendWidth);
  const plotBottom = Math.max(plotTop + 8, rect.bottom - bottomAxisHeight);
  const plotRect = new DOMRect(plotLeft, plotTop, plotRight - plotLeft, plotBottom - plotTop);
  const titleRect = titlePart ? new DOMRect(rect.left, rect.top, rect.width, titleHeight) : null;
  const columnFacetRect = columnFacetPart
    ? new DOMRect(plotLeft, rect.top + titleHeight, plotRect.width, columnFacetHeight)
    : null;
  const rowFacetRect = rowFacetPart
    ? new DOMRect(rect.left, plotTop, leftGutter, plotRect.height)
    : null;
  const leftAxisRect = new DOMRect(rect.left, plotTop, leftGutter, plotRect.height);
  const bottomAxisRect = new DOMRect(plotLeft, plotBottom, plotRect.width, bottomAxisHeight);
  const legendRect =
    legendWidth > 0 ? new DOMRect(plotRight, rect.top, legendWidth, rect.height) : null;
  return {
    bottomAxisRect,
    columnCount,
    columnFacetPart,
    columnFacetRect,
    columnValues,
    hasFacet,
    leftAxisRect,
    legendRect,
    plotRect,
    rowCount,
    rowFacetPart,
    rowFacetRect,
    rowValues,
    titlePart,
    titleRect,
  };
}

function panelAtPoint(layout: CanvasLayout, point: ViewportPoint) {
  const columnWidth = layout.plotRect.width / layout.columnCount;
  const rowHeight = layout.plotRect.height / layout.rowCount;
  const columnIndex = clampIndex(
    Math.floor((point.x - layout.plotRect.left) / columnWidth),
    layout.columnCount,
  );
  const rowIndex = clampIndex(
    Math.floor((point.y - layout.plotRect.top) / rowHeight),
    layout.rowCount,
  );
  const panelRect = new DOMRect(
    layout.plotRect.left + columnWidth * columnIndex,
    layout.plotRect.top + rowHeight * rowIndex,
    columnWidth,
    rowHeight,
  );
  return {
    columnHeaderRect: new DOMRect(
      panelRect.left,
      layout.columnFacetRect?.top ?? panelRect.top,
      panelRect.width,
      layout.columnFacetRect?.height ?? 0,
    ),
    columnIndex,
    columnValue: layout.columnValues[columnIndex],
    panelRect,
    rowHeaderRect: new DOMRect(
      layout.rowFacetRect?.left ?? panelRect.left,
      panelRect.top,
      layout.rowFacetRect?.width ?? 0,
      panelRect.height,
    ),
    rowIndex,
    rowValue: layout.rowValues[rowIndex],
  };
}

function partValues(partValue: LensChartPart | null): string[] {
  const values = partValue?.context?.values;
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value)).filter((value) => value.length > 0);
}

function partCount(partValue: LensChartPart | null): number {
  const count = partValue?.context?.count;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
}

function chartPartFromMetadata(
  library: LensChartPart["library"],
  kind: LensChartPartKind,
  fallbackLabel: string,
  fallbackDetail: string,
  metadata: LensChartPart | null,
): LensChartPart {
  const fallbackPart = part(library, kind, fallbackLabel, fallbackDetail);
  if (!metadata) return fallbackPart;
  return {
    ...fallbackPart,
    ...metadata,
    kind,
    label: metadata.label || fallbackPart.label,
    library: metadata.library ?? library,
  };
}

function containsPoint(rect: DOMRect, point: ViewportPoint): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampIndex(value: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Number.isFinite(value) ? value : 0));
}

type FacetLayer = {
  element: Element;
  orientation: "column" | "facet" | "row";
  value: string | null;
};

function facetLayer(element: Element): FacetLayer | null {
  for (const candidate of ancestryCrossingShadow(element)) {
    const role = semanticText(candidate);
    if (role.includes("role-column-header") || role.includes("column-header")) {
      return { element: candidate, orientation: "column", value: textLabel(element) };
    }
    if (role.includes("role-row-header") || role.includes("row-header")) {
      return { element: candidate, orientation: "row", value: textLabel(element) };
    }
    if (candidate.matches?.(FACET_SELECTOR)) {
      return { element: candidate, orientation: "facet", value: textLabel(element) };
    }
  }
  return null;
}

function semanticSvgElementAtPoint(
  element: Element,
  point: ViewportPoint | undefined,
  selector: string,
): Element | null {
  if (!point) return null;
  const svg = closestMatching(element, "svg.marks,svg");
  if (!svg) return null;
  const matches = [...svg.querySelectorAll(selector)]
    .filter((candidate) => containsPoint(candidate.getBoundingClientRect(), point))
    .sort(
      (left, right) =>
        rectArea(left.getBoundingClientRect()) - rectArea(right.getBoundingClientRect()),
    );
  return matches[0] ?? null;
}

function closestSemanticLayer(element: Element, selector: string): Element | null {
  const match = closestMatching(element, selector);
  if (!match) return null;
  if (match.tagName.toLowerCase() === "svg" && match !== element) return null;
  return match;
}

function rectArea(rect: DOMRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function chartHasPart(target: LensTarget | undefined, kind: LensChartPartKind): boolean {
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
  const text = semanticText(element);
  if (/\b(x|bottom)-?axis\b|\baxis-?x\b/.test(text)) return "x";
  if (/\b(y|left)-?axis\b|\baxis-?y\b/.test(text)) return "y";

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

function semanticText(element: Element): string {
  return [
    element.id,
    [...element.classList].join(" "),
    element.getAttribute("aria-label"),
    element.getAttribute("role"),
  ]
    .join(" ")
    .toLowerCase();
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
