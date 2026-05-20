import type { LensTarget, LensTargetKind } from "@/types";

const LENS_TARGET_KINDS: ReadonlySet<string> = new Set<LensTargetKind>([
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
]);

const CAPABILITY_KEYS = new Set([
  "columnarDom",
  "columnarGrid",
  "data",
  "diagnostic",
  "document",
  "interactive",
  "chartPart",
  "media",
  "visualSurface",
]);

const SELECTION_SURFACES = new Set([
  "chart-unit",
  "columnar-dom",
  "columnar-grid",
  "display-cell",
  "document",
  "interactive",
  "marked",
  "media",
  "selector",
  "visual-surface",
]);

const CHART_PART_KINDS = new Set([
  "annotation",
  "axis",
  "legend",
  "mark",
  "plot-area",
  "title",
  "trace",
]);

export function normalizeLensTargets(targets: LensTarget[] | undefined): LensTarget[] {
  if (!Array.isArray(targets)) return [];
  return targets.map((target, index) => {
    if (!target?.id || !target.label || !LENS_TARGET_KINDS.has(target.kind)) {
      throw new Error(`Lens target ${index} is missing canonical id, label, or kind`);
    }
    validateCapabilities(target, index);
    validateSelectionPolicy(target, index);
    validateSelectionModel(target, index);
    validateChartUnits(target, index);
    return target;
  });
}

function validateCapabilities(target: LensTarget, index: number) {
  for (const key of Object.keys(target.capabilities ?? {})) {
    if (!CAPABILITY_KEYS.has(key)) {
      throw new Error(`Lens target ${index} has unknown capability: ${key}`);
    }
  }
}

function validateSelectionPolicy(target: LensTarget, index: number) {
  for (const surface of target.selectionPolicy?.prefer ?? []) {
    if (!SELECTION_SURFACES.has(surface)) {
      throw new Error(`Lens target ${index} has unknown selection surface: ${surface}`);
    }
  }
}

function validateChartUnits(target: LensTarget, index: number) {
  for (const part of target.chart?.parts ?? []) {
    if (!CHART_PART_KINDS.has(part.kind)) {
      throw new Error(`Lens target ${index} has unknown chart unit kind: ${part.kind}`);
    }
  }
}

function validateSelectionModel(target: LensTarget, index: number) {
  const model = target.selectionModel;
  if (!model) return;
  if (!Array.isArray(model.units)) {
    throw new Error(`Lens target ${index} selectionModel.units must be an array`);
  }
  for (const [unitIndex, unit] of model.units.entries()) {
    if (!unit?.kind) {
      throw new Error(`Lens target ${index} selectionModel unit ${unitIndex} is missing kind`);
    }
    for (const key of ["fallbackFor", "requires", "selectors"] as const) {
      const value = unit[key];
      if (value !== undefined && !Array.isArray(value)) {
        throw new Error(
          `Lens target ${index} selectionModel unit ${unitIndex}.${key} must be an array`,
        );
      }
    }
  }
}
