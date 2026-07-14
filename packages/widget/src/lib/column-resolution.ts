import type { LensColumn, LensTarget, ViewportPoint } from "@/types";

import { canvasGridColumnRects, gridCanvasElement } from "@/lib/canvas-grid-geometry";
import {
  COLUMN_ATTRIBUTES,
  COLUMN_INDEX_ATTRIBUTES,
  columnNamesFromCellId,
  matchingColumnByCellId,
  matchingColumnByName,
  normalizeColumnName,
} from "@/lib/column-names";
import {
  ancestryCrossingShadow,
  closestCrossingShadow,
  elementsAtPointCrossingShadow,
  queryAllCrossingShadow,
} from "@/lib/shadow-dom";

function columnByAttributes(element: Element, columns: LensColumn[]): LensColumn | undefined {
  for (const candidate of ancestryCrossingShadow(element)) {
    const cellIdColumn = matchingColumnByCellId(candidate.getAttribute("data-cell-id"), columns);
    if (cellIdColumn) return cellIdColumn;

    const glideColumn = matchingColumnByGlideCellId(candidate, columns);
    if (glideColumn) return glideColumn;

    for (const attribute of COLUMN_ATTRIBUTES) {
      const column = matchingColumnByName(candidate.getAttribute(attribute), columns);
      if (column) return column;
    }
    for (const attribute of COLUMN_INDEX_ATTRIBUTES) {
      const raw = candidate.getAttribute(attribute);
      if (!raw) continue;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) continue;
      const zeroBased = attribute === "aria-colindex" ? parsed - 1 : parsed;
      if (columns[zeroBased]) return columns[zeroBased];
      if (columns[parsed - 1]) return columns[parsed - 1];
    }
  }
  return undefined;
}

function textCandidates(element: Element): string[] {
  const values = new Set<string>();
  const add = (value: string | null | undefined) => {
    const cleaned = value?.trim().replace(/\s+/g, " ");
    if (cleaned) values.add(cleaned);
  };

  for (const candidate of ancestryCrossingShadow(element).slice(0, 8)) {
    add(candidate.getAttribute("title"));
    add(candidate.getAttribute("aria-label"));
    const cellId = candidate.getAttribute("data-cell-id");
    add(cellId);
    for (const name of columnNamesFromCellId(cellId)) {
      add(name);
    }
    for (const attribute of COLUMN_ATTRIBUTES) {
      add(candidate.getAttribute(attribute));
    }
    if (
      candidate === element ||
      candidate.matches("th,td,[role='columnheader'],[role='gridcell']")
    ) {
      add(candidate.textContent);
    }
  }
  return [...values];
}

function columnByCellIndex(element: Element, columns: LensColumn[]): LensColumn | undefined {
  const cell = closestCrossingShadow(
    element,
    "th,td,[role='columnheader'],[role='gridcell'],[role='cell']",
  ) as HTMLElement | null;
  if (!cell) return undefined;
  const row = cell.parentElement;
  const cells = Array.from(row?.children ?? []).filter((child) =>
    child.matches("th,td,[role='columnheader'],[role='gridcell'],[role='cell']"),
  );
  const index = cells.indexOf(cell);
  if (index < 0) return undefined;

  const columnIndex = index - leadingUtilityColumnCount(cell, cells, columns);
  return columns[columnIndex];
}

function columnFromElement(element: Element, columns: LensColumn[]): LensColumn | undefined {
  const attributed = columnByAttributes(element, columns);
  if (attributed) return attributed;

  const indexed = columnByCellIndex(element, columns);
  if (indexed) return indexed;

  const candidates = textCandidates(element).map((value) => normalizeColumnName(value));
  const sortableColumns = columns
    .map((column) => ({ column, name: normalizeColumnName(column.name) }))
    .filter((item) => item.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  return sortableColumns.find(({ name }) => {
    return candidates.some((candidate) => {
      if (candidate === name) return true;
      if (candidate.includes(`_${name}`) || candidate.includes(`${name}_`)) return true;
      return false;
    });
  })?.column;
}

export function resolveColumn(
  element: Element,
  target: LensTarget,
  point?: ViewportPoint,
): LensColumn | undefined {
  const columns = target.columns ?? [];
  if (columns.length === 0) return undefined;

  const canvasColumn = columnByCanvasGridPoint(element, columns, point);
  if (canvasColumn) return canvasColumn;

  const candidateElements = [element, ...elementsAtPointCrossingShadow(point)]
    .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index)
    .filter((candidate) => {
      if (candidate === element) return true;
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1;
    })
    .sort((a, b) => {
      if (a === element) return -1;
      if (b === element) return 1;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    });
  for (const candidate of candidateElements) {
    const column = columnFromElement(candidate, columns);
    if (column) return column;
  }
  return undefined;
}

function matchingColumnByGlideCellId(
  element: Element,
  columns: LensColumn[],
): LensColumn | undefined {
  const value = element.getAttribute("data-testid") || element.getAttribute("id") || "";
  const match = /^glide-cell-(\d+)-\d+$/.exec(value);
  if (!match) return undefined;
  const oneBasedColumn = Number.parseInt(match[1], 10);
  if (!Number.isFinite(oneBasedColumn)) return undefined;
  return columns[oneBasedColumn - 1];
}

function columnByCanvasGridPoint(
  element: Element,
  columns: LensColumn[],
  point?: ViewportPoint,
): LensColumn | undefined {
  if (!point) return undefined;
  const candidates = [element, ...elementsAtPointCrossingShadow(point)].filter(
    (candidate, index, all) => all.indexOf(candidate) === index,
  );
  for (const candidate of candidates) {
    const canvas = gridCanvasElement(candidate);
    if (!canvas) continue;
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width < 2 ||
      rect.height < 2 ||
      point.x < rect.left ||
      point.x > rect.right ||
      point.y < rect.top ||
      point.y > rect.bottom
    ) {
      continue;
    }
    const names = gridColumnNames(candidate, columns);
    if (names.length === 0) continue;
    const index = canvasGridColumnRects(candidate, names.length).findIndex((columnRect) => {
      return (
        point.x >= columnRect.left &&
        point.x <= columnRect.right &&
        point.y >= columnRect.top &&
        point.y <= columnRect.bottom
      );
    });
    if (index < 0) continue;
    return matchingColumnByName(names[index], columns) ?? columns[index];
  }
  return undefined;
}

function gridColumnNames(element: Element, columns: LensColumn[]): string[] {
  const host = closestCrossingShadow(element, "marimo-data-editor");
  const fromHost = host ? hostColumnNames(host) : [];
  if (fromHost.length > 0) return fromHost;
  return columns.map((column) => column.name);
}

function leadingUtilityColumnCount(cell: Element, cells: Element[], columns: LensColumn[]): number {
  const extra = cells.length - columns.length;
  if (extra <= 0) return 0;

  const table = closestCrossingShadow(cell, "table,[role='grid'],[role='table']");
  const headerOffset = table ? leadingOffsetFromHeader(table, columns, extra) : undefined;
  if (headerOffset !== undefined) return headerOffset;

  const leadingCells = cells.slice(0, extra);
  return leadingCells.every(isLikelyUtilityCell) ? extra : 0;
}

function leadingOffsetFromHeader(
  table: Element,
  columns: LensColumn[],
  maxOffset: number,
): number | undefined {
  for (const row of queryAllCrossingShadow(table, "tr,[role='row']")) {
    const cells = Array.from(row.children).filter(isTableCell);
    if (cells.length < columns.length) continue;
    const offsetLimit = Math.min(maxOffset, cells.length - columns.length);
    for (let offset = 0; offset <= offsetLimit; offset += 1) {
      const matches = columns.filter((column, index) => {
        return cellMatchesColumn(cells[index + offset], column, columns);
      }).length;
      if (matches === columns.length) return offset;
    }
  }
  return undefined;
}

function isTableCell(element: Element): boolean {
  return element.matches("th,td,[role='columnheader'],[role='gridcell'],[role='cell']");
}

function cellMatchesColumn(
  element: Element | undefined,
  column: LensColumn,
  columns: LensColumn[],
): boolean {
  if (!element) return false;
  const attributed = columnByAttributes(element, columns);
  if (attributed) return attributed.name === column.name;
  const candidate = normalizeColumnName(element.textContent);
  const name = normalizeColumnName(column.name);
  return candidate === name || (name.length > 2 && candidate.includes(name));
}

function isLikelyUtilityCell(element: Element): boolean {
  const role = element.getAttribute("role");
  if (role === "rowheader") return true;
  if (element.querySelector("input[type='checkbox'],[role='checkbox']")) return true;
  const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!text) return true;
  if (/^-?\d+$/.test(text)) return true;
  return text === "select row" || text === "select all";
}

function hostColumnNames(host: Element): string[] {
  for (const attribute of ["data-field-types", "data-columns"]) {
    const parsed = parseColumnNamePayload(host.getAttribute(attribute));
    if (parsed.length > 0) return parsed;
  }
  return [];
}

function parseColumnNamePayload(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (Array.isArray(item)) return item[0];
        if (item && typeof item === "object" && "name" in item) {
          return (item as { name?: unknown }).name;
        }
        return item;
      })
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
