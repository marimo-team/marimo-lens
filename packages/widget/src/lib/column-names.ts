import type { LensColumn } from "@/types";

export const COLUMN_ATTRIBUTES = [
  "data-column",
  "data-column-name",
  "data-field",
  "data-key",
  "data-name",
  "data-col",
  "field",
] as const;
export const COLUMN_INDEX_ATTRIBUTES = [
  "aria-colindex",
  "data-colindex",
  "data-col-index",
] as const;

export function normalizeColumnName(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^column\s+/i, "")
    .replace(/\s+/g, " ");
}

export function matchingColumnByName(
  value: string | null | undefined,
  columns: LensColumn[],
): LensColumn | undefined {
  const normalized = normalizeColumnName(value);
  if (!normalized) return undefined;
  return columns.find((column) => normalizeColumnName(column.name) === normalized);
}

export function columnNamesFromCellId(value: string | null | undefined): string[] {
  const normalized = normalizeColumnName(value);
  if (!normalized) return [];

  const names = new Set<string>();
  for (const delimiter of ["_", "-", ":", ".", "/"]) {
    const index = normalized.indexOf(delimiter);
    if (index < 0) continue;
    const trailing = normalized.slice(index + 1).trim();
    if (trailing) names.add(trailing);
  }
  return [...names];
}

export function matchingColumnByCellId(
  value: string | null | undefined,
  columns: LensColumn[],
): LensColumn | undefined {
  const normalized = normalizeColumnName(value);
  if (!normalized) return undefined;

  const direct = matchingColumnByName(normalized, columns);
  if (direct) return direct;

  const candidates = new Set([normalized, ...columnNamesFromCellId(normalized)]);
  const sortableColumns = columns
    .map((column) => ({ column, name: normalizeColumnName(column.name) }))
    .filter((item) => item.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  for (const { column, name } of sortableColumns) {
    if (candidates.has(name)) return column;
    if (
      normalized.endsWith(`_${name}`) ||
      normalized.endsWith(`-${name}`) ||
      normalized.endsWith(`:${name}`) ||
      normalized.endsWith(`.${name}`) ||
      normalized.endsWith(`/${name}`)
    ) {
      return column;
    }
  }
  return undefined;
}
