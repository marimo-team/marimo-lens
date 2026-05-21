import type { SelectionGranularity } from "@/types";

const GRANULARITY_BY_KIND: Record<string, SelectionGranularity> = {
  axis: "group",
  cell: "item",
  column: "group",
  datum: "datum",
  facet: "group",
  legend: "group",
  mark: "item",
  target: "target",
  trace: "item",
};

export function granularityForSelectionKind(kind: string): SelectionGranularity {
  return GRANULARITY_BY_KIND[kind] ?? "surface";
}

export function granularityForChartPart(kind: string, hasDatum = false): SelectionGranularity {
  return hasDatum ? "datum" : granularityForSelectionKind(kind);
}
