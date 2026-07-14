import type {
  LensChartPart,
  LensTarget,
  SelectionEvidence,
  SelectionGranularity,
  SelectionHighlight,
  SelectionModelUnit,
  SelectionSurface,
  SemanticSelection,
  ViewportPoint,
} from "@/types";

import { identifyElement } from "@/lib/element-identification";
import { closestCrossingShadow } from "@/lib/shadow-dom";
import { normalizeText } from "@/lib/text-format";
import { matchingChartLibraries } from "@/selection/chart-parts/chart-library-matching";
import { granularityForSelectionKind } from "@/selection/selection-granularity";

export type SemanticHit = {
  surface: SelectionSurface;
  desiredKind: string;
  id?: string;
  element: Element;
  sourceElement?: Element;
  point?: ViewportPoint;
  label?: string;
  granularity?: SelectionGranularity;
  data?: Record<string, unknown>;
  evidenceKind?: string;
  hitKind?: string;
  selector?: string;
  highlight?: SelectionHighlight;
  highlights?: Partial<Record<string, SelectionHighlight>>;
  anchorData?: Record<string, unknown>;
};

type UnitResolution =
  | {
      reason: "default" | "exact" | "fallback";
      unit: SelectionModelUnit;
    }
  | {
      reason: "synthetic";
      unit: null;
    };

export function semanticSelectionFromHit(target: LensTarget, hit: SemanticHit): SemanticSelection {
  const resolution = resolveSelectionUnit(target, hit);
  const unit = resolution.unit;
  const kind = unit?.kind ?? hit.desiredKind;
  const highlight = hit.highlights?.[kind] ??
    hit.highlights?.[hit.desiredKind] ??
    hit.highlight ?? {
      kind: "element",
      element: hit.element,
      strategy: kind,
    };
  const unitData = unit ? selectionUnitData(unit, resolution.reason) : undefined;
  const data = {
    ...mergedHitData(unit?.data, hit.data),
    surface: hit.data?.surface ?? hit.surface,
    selectionSurface: hit.surface,
    desiredKind: hit.desiredKind,
    semanticResolution: {
      reason: resolution.reason,
      unitId: unit?.id,
      unitKind: unit?.kind,
    },
    ...(unitData ? { unit: unitData } : {}),
  };

  return {
    id: hit.id ?? unit?.id ?? `${kind}:${target.id}`,
    targetId: target.id,
    kind,
    granularity: unit?.granularity ?? hit.granularity ?? granularityForSelectionKind(kind),
    label: unit?.label ?? hit.label ?? target.variable ?? target.label,
    parentId: unit?.parentId ?? target.id,
    data,
    evidence: [selectionEvidence(target, hit, unit, resolution.reason)],
    highlight,
    anchor: {
      element: hit.sourceElement ?? hit.element,
      selector: hit.selector,
      point: hit.point,
      data: {
        hitKind: hit.hitKind ?? hit.desiredKind,
        desiredKind: hit.desiredKind,
        resolvedKind: kind,
        ...hit.anchorData,
      },
    },
  };
}

function mergedHitData(
  unitData: Record<string, unknown> | undefined,
  hitData: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const data = unitData ? { ...unitData } : {};
  if (hitData) Object.assign(data, hitData);
  const chartPart = mergedChartPart(unitData?.chartPart, hitData?.chartPart);
  return chartPart ? { ...data, chartPart } : data;
}

function mergedChartPart(unitPart: unknown, hitPart: unknown): unknown {
  if (!isRecord(unitPart)) return hitPart;
  if (!isRecord(hitPart)) return unitPart;
  return {
    ...hitPart,
    ...unitPart,
    context: mergeOptionalRecord(unitPart.context, hitPart.context),
    datum: mergeOptionalRecord(unitPart.datum, hitPart.datum),
    extensions: mergeOptionalRecord(unitPart.extensions, hitPart.extensions),
  };
}

function mergeOptionalRecord(left: unknown, right: unknown): Record<string, unknown> | undefined {
  const merged = {
    ...(isRecord(left) ? left : {}),
    ...(isRecord(right) ? right : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveSelectionUnit(target: LensTarget, hit: SemanticHit): UnitResolution {
  const units = selectionUnits(target);
  const exact = bestUnit(units, hit, (unit) => unit.kind === hit.desiredKind);
  if (exact) return { reason: "exact", unit: exact };

  const fallback = bestUnit(units, hit, (unit) =>
    (unit.fallbackFor ?? []).includes(hit.desiredKind),
  );
  if (fallback) return { reason: "fallback", unit: fallback };

  const defaultKind = target.selectionModel?.defaultFallback;
  const defaultUnit = defaultKind
    ? bestUnit(units, hit, (unit) => unit.kind === defaultKind && canUseDefaultUnit(unit, hit))
    : null;
  if (defaultUnit) return { reason: "default", unit: defaultUnit };

  return { reason: "synthetic", unit: null };
}

function canUseDefaultUnit(unit: SelectionModelUnit, hit: SemanticHit): boolean {
  const unitColumn = unit.data?.column ?? unit.match?.column;
  if (unitColumn !== undefined && hit.data?.column === undefined) return false;
  const unitChartPart = unit.data?.chartPart;
  if (unitChartPart !== undefined && hit.data?.chartPart === undefined) {
    return false;
  }
  return true;
}

function selectionUnits(target: LensTarget): SelectionModelUnit[] {
  const declared = target.selectionModel?.units ?? [];
  return [...declared];
}

function bestUnit(
  units: readonly SelectionModelUnit[],
  hit: SemanticHit,
  predicate: (unit: SelectionModelUnit) => boolean,
): SelectionModelUnit | null {
  const candidates = units
    .filter((unit) => unit.supported !== false && predicate(unit))
    .map((unit) => ({ unit, score: scoreUnit(unit, hit) }))
    .filter(
      (candidate): candidate is { unit: SelectionModelUnit; score: number } =>
        candidate.score !== null,
    )
    .sort((left, right) => right.score - left.score);
  return candidates[0]?.unit ?? null;
}

function scoreUnit(unit: SelectionModelUnit, hit: SemanticHit): number | null {
  return sumMatchScores([
    unit.priority ?? 0,
    unit.kind === hit.desiredKind ? 40 : 0,
    (unit.fallbackFor ?? []).includes(hit.desiredKind) ? 25 : 0,
    requirementMatchScore(unit, hit),
    explicitMatchScore(unit, hit),
    chartPartMatchScore(unit, hit),
    selectorMatchScore(unit, hit),
  ]);
}

function requirementMatchScore(unit: SelectionModelUnit, hit: SemanticHit): number | null {
  let score = 0;
  for (const key of unit.requires ?? []) {
    if (!hasEvidenceValue(hit, key)) return null;
    score += 12;
  }
  return score;
}

function explicitMatchScore(unit: SelectionModelUnit, hit: SemanticHit): number | null {
  let score = 0;
  const hitData = hit.data ?? {};
  const unitMatch = unit.match ?? {};
  for (const [key, expected] of Object.entries(unitMatch)) {
    if (key === "chartPart") continue;
    if (expected === undefined || expected === null) continue;
    const actual = hitData[key] ?? chartPartValue(hit, key);
    if (actual === undefined || actual === null) return null;
    if (!matchesExpectedValue(key, actual, expected)) return null;
    score += 20;
  }
  return score;
}

function hasEvidenceValue(hit: SemanticHit, key: string): boolean {
  const value = hit.data?.[key] ?? chartPartValue(hit, key);
  return value !== undefined && value !== null && value !== "";
}

function chartPartMatchScore(unit: SelectionModelUnit, hit: SemanticHit): number | null {
  const hitPart = chartPartFromUnknown(hit.data?.chartPart);
  const unitPart = chartPartFromUnknown(unit.data?.chartPart);
  if (!hitPart && !unitPart) return 0;
  if (!hitPart) return unitPart?.kind === hit.desiredKind ? 12 : 0;
  if (!unitPart) return 0;
  if (unitPart.kind !== hitPart.kind) return null;

  let score = 35;
  if (unitPart.id && hitPart.id && unitPart.id === hitPart.id) score += 80;
  if (
    unitPart.library &&
    hitPart.library &&
    matchingChartLibraries(unitPart.library, hitPart.library)
  ) {
    score += 8;
  }
  const fieldScores = sumMatchScores([
    matchingFieldScore(unitPart, hitPart, "field", 28),
    matchingFieldScore(unitPart, hitPart, "channel", 18),
    matchingFieldScore(unitPart, hitPart, "orientation", 18),
  ]);
  if (fieldScores === null) return null;
  score += fieldScores;
  if (normalizeText(unitPart.label) === normalizeText(hitPart.label)) score += 12;
  if (
    unitPart.detail &&
    hitPart.detail &&
    normalizeText(unitPart.detail) === normalizeText(hitPart.detail)
  ) {
    score += 10;
  }
  return score;
}

function matchingFieldScore(
  left: LensChartPart,
  right: LensChartPart,
  key: "channel" | "field" | "orientation",
  value: number,
): number | null {
  if (!left[key] || !right[key]) return 0;
  return normalizeText(left[key]) === normalizeText(right[key]) ? value : null;
}

function chartPartValue(hit: SemanticHit, key: string): unknown {
  const part = chartPartFromUnknown(hit.data?.chartPart);
  if (!part) return undefined;
  if (key === "chartKind") return part.kind;
  return (part as unknown as Record<string, unknown>)[key];
}

function matchesExpectedValue(key: string, actual: unknown, expected: unknown): boolean {
  if (key === "library") {
    return matchingChartLibraries(String(expected), String(actual));
  }
  if (key === "label" || key === "detail") {
    return normalizeText(actual) === normalizeText(expected);
  }
  return String(actual) === String(expected);
}

function selectorMatchScore(unit: SelectionModelUnit, hit: SemanticHit): number | null {
  const selectors = unit.selectors ?? [];
  if (selectors.length === 0) return 0;
  const element = hit.sourceElement ?? hit.element;
  for (const selector of selectors) {
    if (closestCrossingShadow(element, selector)) return 45;
  }
  return 0;
}

function selectionEvidence(
  target: LensTarget,
  hit: SemanticHit,
  unit: SelectionModelUnit | null,
  reason: UnitResolution["reason"],
): SelectionEvidence {
  const evidenceElement = hit.sourceElement ?? hit.element;
  const data = {
    ...hit.data,
    surface: hit.surface,
    desiredKind: hit.desiredKind,
    resolvedKind: unit?.kind ?? hit.desiredKind,
    targetKind: target.kind,
    resolution: reason,
    ...(reason === "fallback" ? { degradedFrom: hit.desiredKind } : {}),
  };
  return {
    kind: hit.evidenceKind ?? "semantic-hit",
    hitKind: hit.hitKind ?? hit.desiredKind,
    selector: hit.selector,
    element: evidenceElement,
    elementName: identifyElement(evidenceElement).name,
    column: stringValue(hit.data?.column),
    rowIndex: numberValue(hit.data?.rowIndex),
    data,
  };
}

function selectionUnitData(unit: SelectionModelUnit, reason: UnitResolution["reason"]) {
  return {
    id: unit.id,
    kind: unit.kind,
    fallbackFor: unit.fallbackFor ?? [],
    match: unit.match ?? {},
    resolution: reason,
    selectors: unit.selectors ?? [],
  };
}

function chartPartFromUnknown(value: unknown): LensChartPart | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LensChartPart>;
  if (typeof candidate.kind !== "string" || typeof candidate.label !== "string") return null;
  return candidate as LensChartPart;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sumMatchScores(scores: Array<number | null>): number | null {
  let total = 0;
  for (const score of scores) {
    if (score === null) return null;
    total += score;
  }
  return total;
}
