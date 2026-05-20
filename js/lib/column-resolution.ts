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
} from "@/lib/shadow-dom";
import type { LensColumn, LensTarget, ViewportPoint } from "@/types";

function columnByAttributes(element: Element, columns: LensColumn[]): LensColumn | undefined {
  for (const candidate of ancestryCrossingShadow(element)) {
    const cellIdColumn = matchingColumnByCellId(candidate.getAttribute("data-cell-id"), columns);
    if (cellIdColumn) return cellIdColumn;

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

  const hasIndexColumn =
    cells.length === columns.length + 1 &&
    (cells[0]?.textContent ?? "").trim().replace(/\s+/g, "").length === 0;
  const columnIndex = hasIndexColumn ? index - 1 : index;
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
      if (candidate.includes(name) && name.length > 2) return true;
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
