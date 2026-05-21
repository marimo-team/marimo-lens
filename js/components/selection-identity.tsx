import type { LucideIcon } from "lucide-react";

import {
  BarChart3,
  Box,
  ChartColumn,
  CircleDot,
  Columns3,
  FileText,
  GitBranch,
  Grid3X3,
  Image,
  LayoutDashboard,
  MousePointer2,
  SlidersHorizontal,
  Table2,
  Tags,
  TriangleAlert,
  Variable,
} from "lucide-react";

import type { LensTarget, ResolvedHover } from "@/types";

import { cellLabel, compact, shapeText, targetKindLabel, targetName } from "@/lib/target-labels";

const TARGET_ICONS: Partial<Record<LensTarget["kind"], LucideIcon>> = {
  anywidget: SlidersHorizontal,
  data: Columns3,
  dataframe: Table2,
  diagnostic: TriangleAlert,
  document: FileText,
  layout: LayoutDashboard,
  media: Image,
  output: Box,
  table: Table2,
  ui: SlidersHorizontal,
  visualization: BarChart3,
};

const CHART_PART_ICONS: Partial<
  Record<NonNullable<ResolvedHover["chartPart"]>["kind"], LucideIcon>
> = {
  annotation: MousePointer2,
  axis: GitBranch,
  facet: Grid3X3,
  legend: Tags,
  mark: ChartColumn,
  "plot-area": Box,
  title: MousePointer2,
  trace: ChartColumn,
};

const CHART_PART_LABELS: Partial<Record<NonNullable<ResolvedHover["chartPart"]>["kind"], string>> =
  {
    facet: "facet",
    "plot-area": "area",
    trace: "trace",
  };

const SEMANTIC_SELECTION_LABELS: Record<string, string> = {
  channel: "Chart channel",
  "dtype-label": "Column type",
  encoding: "Chart encoding",
  facet: "Chart facet",
  "summary-stat": "Column summary",
};

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
        shapeText(target, { columns: false }),
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
    secondary: compact([targetKindLabel(target), shapeText(target), target.component]),
  };
}

function targetIcon(kind: LensTarget["kind"]): LucideIcon {
  return TARGET_ICONS[kind] ?? Variable;
}

function chartPartIcon(kind: NonNullable<ResolvedHover["chartPart"]>["kind"]): LucideIcon {
  return CHART_PART_ICONS[kind] ?? CircleDot;
}

function chartPartKindLabel(kind: NonNullable<ResolvedHover["chartPart"]>["kind"]): string {
  return CHART_PART_LABELS[kind] ?? kind;
}

function semanticSelectionKindLabel(kind: string): string {
  return SEMANTIC_SELECTION_LABELS[kind] ?? kind.replace(/-/g, " ");
}
