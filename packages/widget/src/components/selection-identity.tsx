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

type SelectionIdentityModel = {
  icon: LucideIcon;
  primary: string;
  secondary: string;
};

type SelectionIdentityRule = {
  identity: (hover: ResolvedHover) => SelectionIdentityModel;
  matches: (hover: ResolvedHover) => boolean;
};

const SELECTION_IDENTITY_RULES: SelectionIdentityRule[] = [
  {
    matches: ({ chartPart }) => Boolean(chartPart),
    identity: chartPartIdentity,
  },
  {
    matches: ({ semanticSelection }) => semanticSelection.kind === "cell",
    identity: ({ column, semanticSelection, target }) => ({
      icon: CircleDot,
      primary: semanticSelection.label,
      secondary: compact([
        "Table cell",
        column ? `Column ${column.name}` : null,
        targetName(target),
      ]),
    }),
  },
  {
    matches: ({ semanticSelection }) =>
      semanticSelection.kind === "summary-stat" || semanticSelection.kind === "dtype-label",
    identity: ({ semanticSelection, target }) => ({
      icon: Columns3,
      primary: semanticSelection.label,
      secondary: compact([semanticSelectionKindLabel(semanticSelection.kind), targetName(target)]),
    }),
  },
  {
    matches: ({ column }) => Boolean(column),
    identity: columnIdentity,
  },
  {
    matches: ({ semanticSelection, target }) =>
      target.kind === "output" && semanticSelection.kind === "output",
    identity: ({ target }) => ({
      icon: targetIcon(target.kind),
      primary: targetName(target),
      secondary: compact([targetKindLabel(target), target.outputType, cellLabel(target)]),
    }),
  },
  {
    matches: ({ semanticSelection }) =>
      semanticSelection.kind !== "target" && semanticSelection.kind !== "surface",
    identity: ({ semanticSelection, target }) => ({
      icon: targetIcon(target.kind),
      primary: semanticSelection.label,
      secondary: compact([semanticSelectionKindLabel(semanticSelection.kind), targetName(target)]),
    }),
  },
];

export function SelectionIdentity({ hover, variant = "hover" }: SelectionIdentityProps) {
  const identity = selectionIdentity(hover);
  return (
    <div className="ml-identity" data-variant={variant}>
      <SelectionIdentityIcon hover={hover} size={variant === "popup" ? 16 : 14} />
      <span className="ml-identity__copy">
        <span className="ml-identity__primary">{identity.primary}</span>
        <span className="ml-identity__secondary">{identity.secondary}</span>
      </span>
    </div>
  );
}

export function SelectionIdentityIcon({
  hover,
  size = 14,
}: {
  hover: ResolvedHover;
  size?: number;
}) {
  const identity = selectionIdentity(hover);
  const Icon = identity.icon;
  return (
    <span
      className="ml-identity__icon"
      data-kind={hover.chartPart?.kind ?? hover.semanticSelection.kind ?? hover.target.kind}
    >
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

function selectionIdentity(hover: ResolvedHover) {
  return (
    SELECTION_IDENTITY_RULES.find((rule) => rule.matches(hover))?.identity(hover) ??
    targetIdentity(hover)
  );
}

function targetIdentity({ target }: ResolvedHover): SelectionIdentityModel {
  return targetIdentityFromTarget(target);
}

function targetIdentityFromTarget(target: LensTarget): SelectionIdentityModel {
  return {
    icon: targetIcon(target.kind),
    primary: targetName(target),
    secondary: compact([targetKindLabel(target), shapeText(target), target.component]),
  };
}

function chartPartIdentity({ chartPart, target }: ResolvedHover): SelectionIdentityModel {
  if (!chartPart) return targetIdentityFromTarget(target);
  return {
    icon: chartPartIcon(chartPart.kind),
    primary: chartPart.label,
    secondary: compact([
      `Chart ${chartPartKindLabel(chartPart.kind)}`,
      chartPartDatumSummary(chartPart.datum),
      chartPart.detail ? `about ${chartPart.detail}` : null,
      targetName(target),
    ]),
  };
}

function columnIdentity({ column, target }: ResolvedHover): SelectionIdentityModel {
  if (!column) return targetIdentityFromTarget(target);
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

function targetIcon(kind: LensTarget["kind"]): LucideIcon {
  return TARGET_ICONS[kind] ?? Variable;
}

function chartPartIcon(kind: NonNullable<ResolvedHover["chartPart"]>["kind"]): LucideIcon {
  return CHART_PART_ICONS[kind] ?? CircleDot;
}

function chartPartKindLabel(kind: NonNullable<ResolvedHover["chartPart"]>["kind"]): string {
  return CHART_PART_LABELS[kind] ?? kind;
}

function chartPartDatumSummary(datum: Record<string, unknown> | undefined): string | null {
  if (!datum) return null;
  const summary = Object.entries(datum)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  return summary ? `datum ${summary}` : null;
}

function semanticSelectionKindLabel(kind: string): string {
  return SEMANTIC_SELECTION_LABELS[kind] ?? kind.replace(/-/g, " ");
}
