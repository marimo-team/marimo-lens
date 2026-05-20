import { closestCrossingShadow } from "@/lib/shadow-dom";
import { defineChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";
import { resolveGenericSvgSceneMatch } from "@/selection/chart-units/generic-svg-scene";

type GenericSvgMatch = ReturnType<typeof resolveGenericSvgSceneMatch>;

const svgSceneCache = new WeakMap<Element, { key: string; match: GenericSvgMatch }>();

export const genericSvgChartUnitAdapter = defineChartUnitAdapter({
  id: "generic-svg",
  priority: 700,
  match: ({ element, point }) => {
    const svg = closestCrossingShadow(element, "svg") ?? element;
    const key = point
      ? `${Math.round(point.x / 4)}:${Math.round(point.y / 4)}`
      : elementKey(element);
    const cached = svgSceneCache.get(svg);
    if (cached?.key === key) return cached.match;

    const match = resolveGenericSvgSceneMatch(element, point);
    svgSceneCache.set(svg, { key, match });
    return match;
  },
});

function elementKey(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList].slice(0, 3).join(".");
  return `${element.tagName.toLowerCase()}${id}.${classes}:${element.textContent?.length ?? 0}`;
}
