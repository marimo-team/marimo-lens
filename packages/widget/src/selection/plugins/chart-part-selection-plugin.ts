import type { ChartPartMatch } from "@/selection/chart-parts/chart-part-adapter";
import type { LensChartPart, LensTarget } from "@/types";

import { resolveChartPart } from "@/selection/chart-parts/chart-part-registry";
import { granularityForChartPart } from "@/selection/selection-granularity";
import { semanticSelectionFromHit } from "@/selection/selection-model";
import { defineSelectionPlugin } from "@/selection/selection-plugin";

type ChartPartCandidate = {
  index: number;
  match: ChartPartMatch | null;
  score: number;
  target: LensTarget;
};

export const chartPartSelectionPlugin = defineSelectionPlugin({
  id: "chart-part",
  surface: "chart-part",
  priority: 925,
  select: ({ element, point, targets }) => {
    const visualTargets = targets.filter((target) => target.capabilities?.chartPart === true);
    const candidates = visualTargets
      .map((target, index): ChartPartCandidate => {
        const match = resolveChartPart(element, point, target);
        return {
          index,
          target,
          match,
          score: (match?.score ?? 0) + chartTargetStrength(target),
        };
      })
      .filter((candidate) => candidate.match !== null)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const winner = candidates[0];
    if (!winner?.match) return null;
    if (!topCandidatesAreEquivalent(candidates, winner)) return null;
    const { match, target } = winner;
    return {
      target,
      semanticSelection: semanticSelectionFromHit(target, {
        surface: "chart-part",
        desiredKind: match.part.kind,
        granularity: granularityForChartPart(match.part.kind, Boolean(match.part.datum)),
        label: match.part.label,
        element: match.element,
        sourceElement: element,
        point,
        evidenceKind: "chart-hit",
        hitKind: "chart-part",
        data: {
          surface: "chart-part",
          chartPart: match.part,
          ...match.context,
          ...match.anchorData,
        },
        highlight: match.highlight ?? {
          kind: "element",
          element: match.element,
          padding: 4,
          strategy: "chart-part",
        },
        anchorData: match.anchorData,
      }),
      score: winner.score,
    };
  },
});

function chartTargetStrength(target: { kind: string; variable?: string }): number {
  if (target.kind === "output") return 0;
  return target.variable ? 2 : 1;
}

function topCandidatesAreEquivalent(
  candidates: ChartPartCandidate[],
  winner: ChartPartCandidate,
): boolean {
  return candidates
    .filter((candidate) => candidate.score === winner.score)
    .every((candidate) => equivalentChartPartMatch(candidate.match, winner.match));
}

function equivalentChartPartMatch(
  candidate: ChartPartMatch | null,
  winner: ChartPartMatch | null,
): boolean {
  if (!candidate || !winner) return false;
  return candidate.element === winner.element && sameChartPart(candidate.part, winner.part);
}

function sameChartPart(left: LensChartPart, right: LensChartPart): boolean {
  return (
    left.library === right.library &&
    left.kind === right.kind &&
    left.channel === right.channel &&
    left.field === right.field &&
    left.orientation === right.orientation
  );
}
