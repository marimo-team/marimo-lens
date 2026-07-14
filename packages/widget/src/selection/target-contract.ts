export const LENS_TARGET_KINDS = [
  "anywidget",
  "data",
  "dataframe",
  "diagnostic",
  "document",
  "layout",
  "media",
  "object",
  "output",
  "table",
  "ui",
  "visualization",
] as const;

export const CAPABILITY_KEYS = [
  "columnarDom",
  "columnarGrid",
  "data",
  "diagnostic",
  "document",
  "interactive",
  "chartPart",
  "media",
  "visualSurface",
] as const;

export const SELECTION_SURFACES = [
  "chart-part",
  "columnar-dom",
  "columnar-grid",
  "display-cell",
  "document",
  "interactive",
  "marked",
  "media",
  "selector",
  "visual-surface",
] as const;

export const SELECTION_GRANULARITIES = ["target", "surface", "group", "item", "datum"] as const;

export const CHART_PART_KINDS = [
  "annotation",
  "axis",
  "facet",
  "legend",
  "mark",
  "plot-area",
  "title",
  "trace",
] as const;

export const AGENT_ACTIVITY_KINDS = [
  "agent-started",
  "agent-finished",
  "cell-mark",
  "annotation-status",
] as const;

export const AGENT_CELL_MARK_STATUSES = [
  "read",
  "claimed",
  "edited",
  "ran",
  "failed",
  "needs-review",
] as const;

export const AGENT_ANNOTATION_STATUSES = [
  "in_progress",
  "addressed",
  "blocked",
  "needs_human",
] as const;

export const AGENT_FINISH_STATUSES = ["completed", "blocked", "failed"] as const;

export type LensTargetKind = (typeof LENS_TARGET_KINDS)[number];
export type SelectionSurface = (typeof SELECTION_SURFACES)[number];
export type SelectionGranularity = (typeof SELECTION_GRANULARITIES)[number];
export type LensChartPartKind = (typeof CHART_PART_KINDS)[number];
