import type { LensTarget } from "@/types";

const TARGET_KIND_LABELS: Partial<Record<LensTarget["kind"], string>> = {
  anywidget: "Interactive widget",
  data: "Data output",
  diagnostic: "Diagnostic output",
  document: "Document output",
  layout: "Layout output",
  media: "Media output",
  ui: "Notebook control",
};

const COMPACT_TARGET_KIND_LABELS: Partial<Record<LensTarget["kind"], string>> = {
  anywidget: "widget",
  document: "document",
  media: "media",
  ui: "control",
};

const OUTPUT_KIND_LABELS: Record<string, string> = {
  dataframe: "Table output",
  document: "Document output",
  media: "Media output",
  table: "Table output",
  visualization: "Chart output",
};

export function targetName(target: LensTarget): string {
  return target.variable || target.label;
}

export function compact(items: Array<string | number | null | undefined | false>): string {
  const parts: string[] = [];
  for (const item of items) {
    const text = String(item ?? "").trim();
    if (text) parts.push(text);
  }
  return parts.join(" · ");
}

export function targetKindLabel(target: LensTarget): string {
  if (target.kind === "output") return outputKindLabel(target);
  if (target.kind === "dataframe" || target.kind === "table") return "Data table";
  if (target.kind === "visualization" || target.capabilities?.chartPart) return "Chart output";
  const label = TARGET_KIND_LABELS[target.kind];
  if (label) return label;
  return "Notebook value";
}

export function compactTargetKindLabel(target: LensTarget): string {
  if (target.kind === "dataframe" || target.kind === "table") return "table";
  if (target.kind === "visualization" || target.capabilities?.chartPart) return "chart";
  if (target.kind === "output") return target.output?.kind ?? "output";
  return COMPACT_TARGET_KIND_LABELS[target.kind] ?? target.kind;
}

export function outputKindLabel(target: LensTarget): string {
  const outputKind = target.output?.kind;
  if (outputKind && OUTPUT_KIND_LABELS[outputKind]) return OUTPUT_KIND_LABELS[outputKind];
  if (target.outputType?.toLowerCase().includes("markdown")) return "Markdown output";
  return "Cell output";
}

export function cellLabel(target: LensTarget): string {
  return target.cellId ? `Cell ${target.cellId}` : "";
}

export function shapeText(
  target: LensTarget,
  options: { columns?: boolean; compact?: boolean } = {},
): string {
  const rows = target.shape?.rows;
  const columns = target.shape?.columns;
  if (typeof rows === "number" && typeof columns === "number" && options.compact) {
    return `${rows.toLocaleString()} x ${columns.toLocaleString()}`;
  }
  if (typeof rows !== "number") {
    return target.columns?.length && options.compact
      ? `${target.columns.length.toLocaleString()} ${
          target.columns.length === 1 ? "column" : "columns"
        }`
      : "";
  }
  if (options.columns === false || typeof columns !== "number") {
    return `${rows.toLocaleString()} rows`;
  }
  return `${rows.toLocaleString()} rows, ${columns.toLocaleString()} columns`;
}
