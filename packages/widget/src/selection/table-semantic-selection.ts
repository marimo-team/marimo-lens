import type { LensColumn, LensTarget, SemanticSelection, ViewportPoint } from "@/types";

import { canvasGridColumnRects, gridCanvasElement } from "@/lib/canvas-grid-geometry";
import { COLUMN_ATTRIBUTES } from "@/lib/column-names";
import { resolveColumn } from "@/lib/column-targeting";
import {
  ancestryCrossingShadow,
  closestCrossingShadow,
  elementsAtPointCrossingShadow,
  queryAllCrossingShadow,
} from "@/lib/shadow-dom";
import { semanticSelectionFromHit } from "@/selection/selection-model";

type TableSemanticSelectionOptions = {
  target: LensTarget;
  sourceElement: Element;
  surface: Element;
  surfaceName: string;
  point?: ViewportPoint;
};

type TableHit = {
  element: Element;
  kind:
    | "body-cell"
    | "dtype-label"
    | "grid-cell"
    | "header"
    | "index-cell"
    | "summary-stat"
    | "surface";
  rowIndex?: number;
};

const CELL_SELECTOR = [
  "th",
  "td",
  "[role='columnheader']",
  "[role='gridcell']",
  "[role='cell']",
  "[role='rowheader']",
  "[data-cell-id]",
  "[data-column]",
  "[data-column-name]",
  "[data-field]",
].join(",");

const DTYPE_SELECTOR = [
  "[data-marimo-lens-dtype]",
  "[data-dtype]",
  "[data-type='dtype']",
  "[class*='dtype' i]",
].join(",");

const SUMMARY_SELECTOR = [
  "[data-marimo-lens-summary]",
  "[data-summary]",
  "[data-stat]",
  "[data-type='summary']",
  "[class*='summary' i]",
].join(",");

export function tableSemanticSelection({
  target,
  sourceElement,
  surface,
  surfaceName,
  point,
}: TableSemanticSelectionOptions): SemanticSelection | null {
  const tableSurface =
    closestCrossingShadow(sourceElement, "table,[role='table'],[role='grid']") ?? surface;
  const hit = classifyTableHit(sourceElement, tableSurface, point);
  const column = resolveColumn(sourceElement, target, point);
  if (!column) return surfaceSelection(target, sourceElement, tableSurface, surfaceName, hit);

  const desiredKind = desiredKindForHit(hit.kind);
  return semanticSelectionFromHit(target, {
    surface: surfaceName === "columnar-grid" ? "columnar-grid" : "columnar-dom",
    desiredKind,
    element: hit.element,
    sourceElement,
    point,
    label: tableHitLabel(column, hit),
    granularity: desiredKind === "cell" ? "item" : "group",
    data: {
      column: column.name,
      columnDtype: column.dtype ?? null,
      hitKind: hit.kind,
      rowIndex: hit.rowIndex,
      surface: surfaceName,
    },
    evidenceKind: "table-hit",
    hitKind: hit.kind,
    highlights: {
      cell: cellHighlight(hit),
      column: columnHighlight(target, column, tableSurface, hit, point),
      "dtype-label": cellHighlight(hit),
      "summary-stat": cellHighlight(hit),
      surface: surfaceHighlight(tableSurface),
    },
    anchorData: {
      hitKind: hit.kind,
      column: column.name,
      rowIndex: hit.rowIndex,
    },
  });
}

function columnHighlight(
  target: LensTarget,
  column: LensColumn,
  surface: Element,
  hit: TableHit,
  point?: ViewportPoint,
): SemanticSelection["highlight"] {
  const elements = columnElements(surface, target, column).filter(hasUsableRect);
  const rectHighlight =
    elements.length === 0 ? gridColumnHighlightRect(surface, target, column, point) : null;
  if (rectHighlight) {
    return {
      kind: "rect",
      rect: rectHighlight,
      padding: 1,
      strategy: "table-column",
    };
  }
  return {
    kind: "elements",
    elements: elements.length > 0 ? elements : [surface],
    fallbackElement: hit.element,
    padding: 1,
    strategy: "table-column",
  };
}

function surfaceSelection(
  target: LensTarget,
  sourceElement: Element,
  surface: Element,
  surfaceName: string,
  hit: TableHit,
): SemanticSelection {
  return semanticSelectionFromHit(target, {
    surface: surfaceName === "columnar-grid" ? "columnar-grid" : "columnar-dom",
    desiredKind: "surface",
    id: `surface:${target.id}`,
    element: surface,
    sourceElement,
    label: target.variable ?? target.label,
    granularity: "surface",
    data: {
      hitKind: hit.kind,
      surface: surfaceName,
    },
    evidenceKind: "table-hit",
    hitKind: hit.kind,
    anchorData: {
      hitKind: hit.kind,
      rowIndex: hit.rowIndex,
    },
    highlight: {
      kind: "element",
      element: surface,
      strategy: "table-surface",
    },
  });
}

function classifyTableHit(
  sourceElement: Element,
  surface: Element,
  point?: ViewportPoint,
): TableHit {
  const canvasHit = classifyCanvasGridHit(sourceElement, surface, point);
  if (canvasHit) return canvasHit;

  const evidenceElement = tableEvidenceElement(sourceElement, point) ?? sourceElement;
  const semantic = closestCrossingShadow(evidenceElement, `${DTYPE_SELECTOR},${SUMMARY_SELECTOR}`);
  const hitElement = closestCrossingShadow(evidenceElement, CELL_SELECTOR) ?? semantic ?? surface;
  const rowIndex = rowIndexFor(hitElement, surface);
  if (semantic?.matches(DTYPE_SELECTOR))
    return { element: hitElement, kind: "dtype-label", rowIndex };
  if (semantic?.matches(SUMMARY_SELECTOR)) {
    return { element: hitElement, kind: "summary-stat", rowIndex };
  }

  const role = hitElement.getAttribute("role");
  const tag = hitElement.tagName.toLowerCase();
  if (role === "columnheader" || tag === "th")
    return { element: hitElement, kind: "header", rowIndex };
  if (role === "rowheader") return { element: hitElement, kind: "index-cell", rowIndex };
  if (role === "gridcell") return { element: hitElement, kind: "grid-cell", rowIndex };
  if (tag === "td" || role === "cell") return { element: hitElement, kind: "body-cell", rowIndex };
  if (hitElement !== surface && hasColumnEvidence(hitElement)) {
    return { element: hitElement, kind: "body-cell", rowIndex };
  }
  return { element: surface, kind: "surface", rowIndex };
}

function tableEvidenceElement(sourceElement: Element, point?: ViewportPoint): Element | null {
  for (const candidate of elementsAtPointCrossingShadow(point)) {
    if (closestCrossingShadow(candidate, CELL_SELECTOR)) return candidate;
    if (closestCrossingShadow(candidate, `${DTYPE_SELECTOR},${SUMMARY_SELECTOR}`)) {
      return candidate;
    }
  }
  return sourceElement;
}

function desiredKindForHit(hitKind: TableHit["kind"]): string {
  if (hitKind === "body-cell" || hitKind === "grid-cell") return "cell";
  if (hitKind === "dtype-label" || hitKind === "summary-stat") return hitKind;
  if (hitKind === "header") return "column";
  return "surface";
}

function columnElements(surface: Element, target: LensTarget, column: LensColumn): Element[] {
  const elements = queryAllCrossingShadow(surface, CELL_SELECTOR).filter((candidate) => {
    return resolveColumn(candidate, target)?.name === column.name;
  });
  return elements;
}

function classifyCanvasGridHit(
  sourceElement: Element,
  surface: Element,
  point?: ViewportPoint,
): TableHit | null {
  if (!point) return null;
  const canvas = gridCanvasElement(surface) ?? gridCanvasElement(sourceElement);
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (
    rect.width < 2 ||
    rect.height < 2 ||
    point.x < rect.left ||
    point.x > rect.right ||
    point.y < rect.top ||
    point.y > rect.bottom
  ) {
    return null;
  }
  const headerHeight = Math.min(40, Math.max(28, rect.height * 0.14));
  const rowHeight = Math.max(24, headerHeight);
  return {
    element: canvas,
    kind: point.y <= rect.top + headerHeight ? "header" : "grid-cell",
    rowIndex:
      point.y <= rect.top + headerHeight
        ? undefined
        : Math.max(0, Math.floor((point.y - rect.top - headerHeight) / rowHeight)),
  };
}

function gridColumnHighlightRect(
  surface: Element,
  target: LensTarget,
  column: LensColumn,
  point?: ViewportPoint,
): DOMRect | null {
  if (!point) return null;
  const columns = target.columns ?? [];
  const index = columns.findIndex((candidate) => candidate.name === column.name);
  if (index < 0 || columns.length === 0) return null;
  return canvasGridColumnRects(surface, columns.length)[index] ?? null;
}

function rowIndexFor(element: Element, surface: Element): number | undefined {
  const row = closestCrossingShadow(element, "tr,[role='row']");
  if (!row) return undefined;
  const rows = queryAllCrossingShadow(surface, "tr,[role='row']");
  const index = rows.indexOf(row);
  return index >= 0 ? index : undefined;
}

function hasColumnEvidence(element: Element): boolean {
  for (const candidate of ancestryCrossingShadow(element)) {
    if (COLUMN_ATTRIBUTES.some((attribute) => candidate.hasAttribute(attribute))) return true;
  }
  return false;
}

function hasUsableRect(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function cellHighlight(hit: TableHit): SemanticSelection["highlight"] {
  return {
    kind: "element",
    element: hit.element,
    padding: 1,
    strategy: "table-cell",
  };
}

function surfaceHighlight(surface: Element): SemanticSelection["highlight"] {
  return {
    kind: "element",
    element: surface,
    strategy: "table-surface",
  };
}

function tableHitLabel(column: LensColumn, hit: TableHit): string {
  if (hit.kind === "body-cell" || hit.kind === "grid-cell") {
    return `${column.name}${hit.rowIndex === undefined ? "" : ` row ${hit.rowIndex + 1}`}`;
  }
  return column.name;
}
