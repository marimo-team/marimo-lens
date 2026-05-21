import { ancestryCrossingShadow, closestCrossingShadow } from "@/lib/shadow-dom";
import { defineChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";

export const metadataChartPartAdapter = defineChartPartAdapter({
  id: "metadata-selector",
  priority: 1000,
  match: ({ element, target }) => {
    const parts = target?.chart?.parts ?? [];
    const matches = [];
    for (const part of parts) {
      if (!part.selector) continue;
      const match = closestCrossingShadow(element, part.selector);
      if (!match) continue;
      matches.push({
        element: match,
        part,
        selector: part.selector,
        distance: elementDistance(element, match),
        specificity: selectorSpecificity(part.selector),
      });
    }
    matches.sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return compareSpecificity(right.specificity, left.specificity);
    });
    const winner = matches[0];
    return winner
      ? {
          element: winner.element,
          part: winner.part,
          score: metadataScore(winner.distance, winner.specificity),
          context: {
            selector: winner.selector,
            source: "chart-metadata",
          },
        }
      : null;
  },
});

function elementDistance(source: Element, match: Element): number {
  const index = ancestryCrossingShadow(source).indexOf(match);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

type Specificity = [ids: number, attributes: number, elements: number];

function selectorSpecificity(selector: string): Specificity {
  return (
    selector
      .split(",")
      .map((item) => selectorItemSpecificity(item.trim()))
      .sort((left, right) => compareSpecificity(right, left))[0] ?? [0, 0, 0]
  );
}

function selectorItemSpecificity(selector: string): Specificity {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const attributes =
    (selector.match(/\.[\w-]+/g)?.length ?? 0) +
    (selector.match(/\[[^\]]+\]/g)?.length ?? 0) +
    (selector.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0);
  const stripped = selector
    .replace(/#[\w-]+/g, " ")
    .replace(/\.[\w-]+/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/::[\w-]+/g, " ")
    .replace(/:(?!:)[\w-]+(?:\([^)]*\))?/g, " ");
  const elements = stripped
    .split(/[\s>+~]+/)
    .filter((token) => /^[a-zA-Z][\w-]*$/.test(token)).length;
  return [ids, attributes, elements];
}

function compareSpecificity(left: Specificity, right: Specificity): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function metadataScore(distance: number, specificity: Specificity): number {
  const proximity = Math.max(0, 4 - Math.min(distance, 4));
  const specificityScore = Math.min(4, specificity[0] * 4 + specificity[1] * 2 + specificity[2]);
  return 78 + proximity + specificityScore;
}
