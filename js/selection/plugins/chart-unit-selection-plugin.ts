import { resolveChartUnit } from "@/selection/chart-units/chart-unit-registry";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";
import type { SelectionGranularity } from "@/types";

export const chartUnitSelectionPlugin = defineSelectionPlugin({
  id: "chart-unit",
  surface: "chart-unit",
  priority: 925,
  select: ({ element, point, targets }) => {
    const visualTargets = targets.filter((target) => target.capabilities?.chartPart === true);
    const candidates = visualTargets
      .map((target) => {
        const match = resolveChartUnit(element, point, target);
        return {
          target,
          match,
          score: (match?.score ?? 0) + chartTargetStrength(target),
        };
      })
      .filter((candidate) => candidate.match !== null)
      .sort((left, right) => right.score - left.score);
    const winner = candidates[0];
    if (!winner?.match) return null;
    if (candidates[1]?.score === winner.score) return null;
    const { match, target } = winner;
    return {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        id: chartUnitId(match.unit),
        element: match.element,
        sourceElement: element,
        kind: match.unit.kind,
        granularity: match.unit.datum ? "datum" : chartGranularity(match.unit.kind),
        label: match.unit.label,
        hitKind: "chart-unit",
        data: {
          surface: "chart-unit",
          chartPart: match.unit,
          chartUnit: match.unit,
          ...match.context,
        },
      }),
      score: winner.score,
    };
  },
});

function chartTargetStrength(target: { kind: string; variable?: string }): number {
  if (target.kind === "output") return 0;
  return target.variable ? 2 : 1;
}

function chartUnitId(unit: { id?: string; kind: string; label: string }): string {
  if (unit.id) return unit.id;
  return `chart:${unit.kind}:${unit.label.toLowerCase().replace(/\s+/g, "-")}`;
}

function chartGranularity(kind: string): SelectionGranularity {
  if (kind === "mark" || kind === "trace") return "item";
  if (kind === "axis" || kind === "legend") return "group";
  return "surface";
}
