import {
  BarChart3,
  Box,
  ChartColumn,
  CircleDot,
  Columns3,
  FileText,
  GitBranch,
  Image,
  LayoutDashboard,
  MousePointer2,
  SlidersHorizontal,
  Table2,
  Tags,
  TriangleAlert,
  Variable,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LensTarget, ResolvedHover } from "@/types";

type SelectionIdentityProps = {
  hover: ResolvedHover;
  variant?: "hover" | "popup";
};

export function SelectionIdentity({ hover, variant = "hover" }: SelectionIdentityProps) {
  const identity = selectionIdentity(hover);
  const Icon = identity.icon;
  return (
    <div className="ml-identity" data-variant={variant}>
      <span
        className="ml-identity__icon"
        data-kind={hover.chartPart?.kind ?? hover.semanticSelection.kind ?? hover.target.kind}
      >
        <Icon size={variant === "popup" ? 16 : 14} strokeWidth={1.8} />
      </span>
      <span className="ml-identity__copy">
        <span className="ml-identity__primary">{identity.primary}</span>
        <span className="ml-identity__secondary">{identity.secondary}</span>
      </span>
    </div>
  );
}

function selectionIdentity(hover: ResolvedHover) {
  const { chartPart, column, semanticSelection, target } = hover;
  if (chartPart) {
    return {
      icon: chartPartIcon(chartPart.kind),
      primary: chartPart.label,
      secondary: compact(
        [
          `Chart ${chartPartKindLabel(chartPart.kind)}`,
          chartPart.detail ? `about ${chartPart.detail}` : null,
          targetName(target),
        ].filter(Boolean),
      ),
    };
  }

  if (semanticSelection.kind === "cell") {
    return {
      icon: CircleDot,
      primary: semanticSelection.label,
      secondary: compact([
        "Table cell",
        column ? `Column ${column.name}` : null,
        targetName(target),
      ]),
    };
  }

  if (semanticSelection.kind === "summary-stat" || semanticSelection.kind === "dtype-label") {
    return {
      icon: Columns3,
      primary: semanticSelection.label,
      secondary: compact([semanticSelectionKindLabel(semanticSelection.kind), targetName(target)]),
    };
  }

  if (column) {
    return {
      icon: Columns3,
      primary: column.name,
      secondary: compact([
        `Column in ${targetName(target)}`,
        column.dtype ? `${column.dtype} values` : null,
        formatShapeText(target, { columns: false }),
      ]),
    };
  }

  if (target.kind === "output" && semanticSelection.kind === "output") {
    return {
      icon: targetIcon(target.kind),
      primary: targetName(target),
      secondary: compact([targetKindLabel(target), target.outputType, cellLabel(target)]),
    };
  }

  if (semanticSelection.kind !== "target" && semanticSelection.kind !== "surface") {
    return {
      icon: targetIcon(target.kind),
      primary: semanticSelection.label,
      secondary: compact([semanticSelectionKindLabel(semanticSelection.kind), targetName(target)]),
    };
  }

  return {
    icon: targetIcon(target.kind),
    primary: targetName(target),
    secondary: compact([targetKindLabel(target), formatShapeText(target), target.component]),
  };
}

function targetIcon(kind: LensTarget["kind"]): LucideIcon {
  if (kind === "data") return Columns3;
  if (kind === "dataframe" || kind === "table") return Table2;
  if (kind === "diagnostic") return TriangleAlert;
  if (kind === "document") return FileText;
  if (kind === "layout") return LayoutDashboard;
  if (kind === "media") return Image;
  if (kind === "output") return Box;
  if (kind === "visualization") return BarChart3;
  if (kind === "ui" || kind === "anywidget") return SlidersHorizontal;
  return Variable;
}

function chartPartIcon(kind: NonNullable<ResolvedHover["chartPart"]>["kind"]): LucideIcon {
  if (kind === "axis") return GitBranch;
  if (kind === "legend") return Tags;
  if (kind === "mark" || kind === "trace") return ChartColumn;
  if (kind === "plot-area") return Box;
  if (kind === "title" || kind === "annotation") return MousePointer2;
  return CircleDot;
}

function compact(items: Array<string | number | null | undefined | false>): string {
  const parts: string[] = [];
  for (const item of items) {
    const text = String(item ?? "").trim();
    if (text) parts.push(text);
  }
  return parts.join(" · ");
}

function targetName(target: LensTarget): string {
  return target.variable || target.label;
}

function targetKindLabel(target: LensTarget): string {
  if (target.kind === "dataframe" || target.kind === "table") return "Data table";
  if (target.kind === "visualization") return "Chart output";
  if (target.kind === "anywidget") return "Interactive widget";
  if (target.kind === "ui") return "Notebook control";
  if (target.kind === "media") return "Media output";
  if (target.kind === "document") return "Document output";
  if (target.kind === "data") return "Data output";
  if (target.kind === "diagnostic") return "Diagnostic output";
  if (target.kind === "layout") return "Layout output";
  if (target.kind === "output") return outputKindLabel(target);
  return "Notebook value";
}

function outputKindLabel(target: LensTarget): string {
  const outputKind = target.output?.kind;
  if (outputKind === "visualization") return "Chart output";
  if (outputKind === "dataframe" || outputKind === "table") return "Table output";
  if (outputKind === "document") return "Document output";
  if (outputKind === "media") return "Media output";
  if (target.outputType?.toLowerCase().includes("markdown")) return "Markdown output";
  return "Cell output";
}

function cellLabel(target: LensTarget): string {
  return target.cellId ? `Cell ${target.cellId}` : "";
}

function chartPartKindLabel(kind: NonNullable<ResolvedHover["chartPart"]>["kind"]): string {
  if (kind === "plot-area") return "area";
  if (kind === "trace") return "trace";
  return kind;
}

function semanticSelectionKindLabel(kind: string): string {
  if (kind === "dtype-label") return "Column type";
  if (kind === "summary-stat") return "Column summary";
  if (kind === "encoding") return "Chart encoding";
  if (kind === "facet") return "Chart facet";
  if (kind === "channel") return "Chart channel";
  return kind.replace(/-/g, " ");
}

function formatShapeText(target: LensTarget, options: { columns?: boolean } = {}): string {
  const rows = target.shape?.rows;
  const columns = target.shape?.columns;
  if (typeof rows !== "number") return "";
  if (options.columns === false || typeof columns !== "number") {
    return `${rows.toLocaleString()} rows`;
  }
  return `${rows.toLocaleString()} rows, ${columns.toLocaleString()} columns`;
}
