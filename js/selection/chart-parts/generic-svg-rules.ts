import type { LensChartPartKind } from "@/types";

export type AxisOrientation = "x" | "y" | "unknown";
export type SvgRole = LensChartPartKind;

export const MARK_SELECTOR = "path,rect,circle,ellipse,line,polyline,polygon,use";
export const TEXT_SELECTOR = "text";
export const ROLE_CONTAINER_SELECTOR =
  "g,[role],[aria-label],[data-role],[data-testid],[data-name]";

const MARK_TAGS = new Set(MARK_SELECTOR.split(","));

const ROLE_HINTS: Array<{ role: SvgRole; tokens: readonly string[] }> = [
  { role: "legend", tokens: ["legend", "swatch", "legenditem", "legend-item"] },
  { role: "facet", tokens: ["facet", "header", "row-header", "column-header"] },
  { role: "axis", tokens: ["axis", "tick", "gridline", "grid-line", "domain"] },
  { role: "title", tokens: ["title", "headline"] },
  { role: "annotation", tokens: ["annotation", "callout", "label"] },
  { role: "trace", tokens: ["trace", "series", "line-series"] },
  { role: "mark", tokens: ["mark", "bar", "point", "symbol", "area", "arc"] },
];

const AXIS_ORIENTATION_HINTS: Array<{
  orientation: Exclude<AxisOrientation, "unknown">;
  tokens: readonly string[];
}> = [
  { orientation: "x", tokens: ["x", "xaxis", "x-axis", "bottom", "top"] },
  { orientation: "y", tokens: ["y", "yaxis", "y-axis", "left", "right"] },
];

const VISUAL_LABEL_BY_TAG: Record<string, string> = {
  circle: "point",
  ellipse: "point",
  polygon: "shape",
  rect: "bar",
};

const ROLE_RANK: Record<SvgRole, number> = {
  annotation: 3,
  axis: 4,
  facet: 4,
  legend: 4,
  mark: 5,
  "plot-area": 1,
  title: 3,
  trace: 5,
};

export function explicitSvgRoleFromHint(hint: string): SvgRole | null {
  return ROLE_HINTS.find((rule) => hasSemanticToken(hint, rule.tokens))?.role ?? null;
}

export function axisOrientationFromHint(hint: string): Exclude<AxisOrientation, "unknown"> | null {
  return (
    AXIS_ORIENTATION_HINTS.find((rule) => hasSemanticToken(hint, rule.tokens))?.orientation ?? null
  );
}

export function visualRoleForTag(tag: string, pathData?: string | null): "mark" | "trace" {
  if (tag === "line" || tag === "polyline") return "trace";
  if (tag === "path" && !isClosedPath(pathData)) return "trace";
  return "mark";
}

export function visualLabelForTag(tag: string, role: SvgRole, pathData?: string | null): string {
  if (role === "trace") return tag === "polyline" || tag === "line" ? "line trace" : "path trace";
  if (tag === "path") return isClosedPath(pathData) ? "shape" : "path";
  return VISUAL_LABEL_BY_TAG[tag] ?? (role === "mark" ? "mark" : role);
}

export function axisLabel(orientation: AxisOrientation): string {
  if (orientation === "x") return "x axis";
  if (orientation === "y") return "y axis";
  return "axis";
}

export function hitPadding(role: SvgRole): number {
  return role === "axis" || role === "trace" ? 5 : 3;
}

export function roleRank(role: SvgRole): number {
  return ROLE_RANK[role] ?? 1;
}

export function isMarkTag(tag: string): boolean {
  return MARK_TAGS.has(tag);
}

export function isClosedPath(pathData: string | null | undefined): boolean {
  return /z\s*$/i.test(pathData?.trim() ?? "");
}

export function isBackgroundHint(tag: string, hint: string): boolean {
  return (
    tag === "rect" && hasSemanticToken(hint, ["background", "plot-background", "canvas", "frame"])
  );
}

export function hasSemanticToken(hint: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    const escaped = token.replace(/-/g, "[-_\\s]?");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hint);
  });
}
