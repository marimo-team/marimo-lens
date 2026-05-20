import { resolveColumn } from "@/lib/column-targeting";
import { COLUMN_ATTRIBUTES } from "@/lib/column-names";
import { identifyElement } from "@/lib/element-identification";
import {
  ancestryCrossingShadow,
  closestCrossingShadow,
  queryAllCrossingShadow,
} from "@/lib/shadow-dom";
import type {
  LensColumn,
  LensTarget,
  SemanticSelection,
  SelectionModelUnit,
  ViewportPoint,
} from "@/types";

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
  const hit = classifyTableHit(sourceElement, tableSurface);
  const column = resolveColumn(sourceElement, target, point);
  if (!column) return surfaceSelection(target, sourceElement, tableSurface, surfaceName, hit);

  const desiredKind = desiredKindForHit(hit.kind);
  const supportedKind = supportedKindForHit(target, desiredKind, column);
  if (supportedKind === "cell") {
    return cellSelection(target, column, sourceElement, hit, surfaceName);
  }
  if (supportedKind === "column") {
    return columnSelection(target, column, sourceElement, tableSurface, surfaceName, hit);
  }
  return surfaceSelection(target, sourceElement, tableSurface, surfaceName, hit);
}

function columnSelection(
  target: LensTarget,
  column: LensColumn,
  sourceElement: Element,
  surface: Element,
  surfaceName: string,
  hit: TableHit,
): SemanticSelection {
  const unit = selectionModelUnit(target, "column", column);
  const elements = columnElements(surface, target, column);
  return {
    id: unit?.id ?? `col:${column.name}`,
    targetId: target.id,
    kind: "column",
    granularity: "group",
    label: unit?.label ?? column.name,
    parentId: target.id,
    data: {
      column: column.name,
      columnDtype: column.dtype ?? null,
      hitKind: hit.kind,
      rowIndex: hit.rowIndex,
      surface: surfaceName,
      unit: unit ? unitData(unit) : undefined,
    },
    evidence: [
      {
        kind: "table-hit",
        hitKind: hit.kind,
        element: sourceElement,
        elementName: identifyElement(sourceElement).name,
        column: column.name,
        rowIndex: hit.rowIndex,
        data: {
          degradedFrom: desiredKindForHit(hit.kind),
          surface: surfaceName,
        },
      },
    ],
    highlight: {
      kind: "elements",
      elements,
      fallbackElement: hit.element,
      padding: 1,
      strategy: "table-column",
    },
    anchor: {
      element: sourceElement,
      data: {
        hitKind: hit.kind,
        column: column.name,
      },
    },
  };
}

function cellSelection(
  target: LensTarget,
  column: LensColumn,
  sourceElement: Element,
  hit: TableHit,
  surfaceName: string,
): SemanticSelection {
  return {
    id: `cell:${hit.rowIndex ?? "unknown"}:${column.name}`,
    targetId: target.id,
    kind: "cell",
    granularity: "item",
    label: `${column.name}${hit.rowIndex === undefined ? "" : ` row ${hit.rowIndex + 1}`}`,
    parentId: `col:${column.name}`,
    data: {
      column: column.name,
      columnDtype: column.dtype ?? null,
      hitKind: hit.kind,
      rowIndex: hit.rowIndex,
      surface: surfaceName,
    },
    evidence: [
      {
        kind: "table-hit",
        hitKind: hit.kind,
        element: sourceElement,
        elementName: identifyElement(sourceElement).name,
        column: column.name,
        rowIndex: hit.rowIndex,
      },
    ],
    highlight: {
      kind: "element",
      element: hit.element,
      padding: 1,
      strategy: "table-cell",
    },
    anchor: {
      element: sourceElement,
      data: {
        hitKind: hit.kind,
        column: column.name,
        rowIndex: hit.rowIndex,
      },
    },
  };
}

function surfaceSelection(
  target: LensTarget,
  sourceElement: Element,
  surface: Element,
  surfaceName: string,
  hit: TableHit,
): SemanticSelection {
  return {
    id: `surface:${target.id}`,
    targetId: target.id,
    kind: "surface",
    granularity: "surface",
    label: target.variable ?? target.label,
    parentId: target.id,
    data: {
      hitKind: hit.kind,
      surface: surfaceName,
    },
    evidence: [
      {
        kind: "table-hit",
        hitKind: hit.kind,
        element: sourceElement,
        elementName: identifyElement(sourceElement).name,
        rowIndex: hit.rowIndex,
        data: {
          surface: surfaceName,
        },
      },
    ],
    highlight: {
      kind: "element",
      element: surface,
      strategy: "table-surface",
    },
    anchor: {
      element: sourceElement,
      data: {
        hitKind: hit.kind,
      },
    },
  };
}

function classifyTableHit(sourceElement: Element, surface: Element): TableHit {
  const semantic = closestCrossingShadow(sourceElement, `${DTYPE_SELECTOR},${SUMMARY_SELECTOR}`);
  const hitElement = closestCrossingShadow(sourceElement, CELL_SELECTOR) ?? semantic ?? surface;
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

function desiredKindForHit(hitKind: TableHit["kind"]): string {
  if (hitKind === "body-cell" || hitKind === "grid-cell") return "cell";
  if (hitKind === "dtype-label" || hitKind === "summary-stat") return hitKind;
  if (hitKind === "header") return "column";
  return "surface";
}

function supportedKindForHit(target: LensTarget, desiredKind: string, column: LensColumn): string {
  if (isSupported(target, desiredKind, column)) return desiredKind;
  const fallback = target.selectionModel?.units.find((unit) => {
    return unit.supported !== false && (unit.fallbackFor ?? []).includes(desiredKind);
  });
  if (fallback) return fallback.kind;
  const defaultFallback = target.selectionModel?.defaultFallback;
  if (defaultFallback && isSupported(target, defaultFallback, column)) return defaultFallback;
  return "column";
}

function isSupported(target: LensTarget, kind: string, column: LensColumn): boolean {
  if (kind === "column") return Boolean(column);
  const units = target.selectionModel?.units ?? [];
  return units.some((unit) => unit.kind === kind && unit.supported !== false);
}

function selectionModelUnit(
  target: LensTarget,
  kind: string,
  column: LensColumn,
): SelectionModelUnit | undefined {
  return (target.selectionModel?.units ?? []).find((unit) => {
    if (unit.kind !== kind || unit.supported === false) return false;
    return unit.data?.column === column.name || unit.id === `col:${column.name}`;
  });
}

function columnElements(surface: Element, target: LensTarget, column: LensColumn): Element[] {
  const elements = queryAllCrossingShadow(surface, CELL_SELECTOR).filter((candidate) => {
    return resolveColumn(candidate, target)?.name === column.name;
  });
  return elements.length > 0 ? elements : [surface];
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

function unitData(unit: SelectionModelUnit): Record<string, unknown> {
  return {
    id: unit.id,
    fallbackFor: unit.fallbackFor ?? [],
    selectors: unit.selectors ?? [],
  };
}
