import { closestCrossingShadow } from "@/lib/shadow-dom";
import { defineChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";
import { resolveGenericSvgSceneMatch } from "@/selection/chart-parts/generic-svg-scene";

export const genericSvgChartPartAdapter = defineChartPartAdapter({
  id: "generic-svg",
  priority: 700,
  match: ({ element, point }) => {
    const svg = closestCrossingShadow(element, "svg") ?? element;
    return svg ? resolveGenericSvgSceneMatch(element, point) : null;
  },
});
