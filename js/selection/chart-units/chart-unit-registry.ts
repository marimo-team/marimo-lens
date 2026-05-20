import { elementsAtPointCrossingShadow } from "@/lib/shadow-dom";
import { altairVegaChartUnitAdapter } from "@/selection/chart-units/altair-vega-chart-unit-adapter";
import type { ChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";
import type { ChartUnitMatch } from "@/selection/chart-units/chart-unit-adapter";
import { genericSvgChartUnitAdapter } from "@/selection/chart-units/generic-svg-chart-unit-adapter";
import { matplotlibChartUnitAdapter } from "@/selection/chart-units/matplotlib-chart-unit-adapter";
import { metadataChartUnitAdapter } from "@/selection/chart-units/metadata-chart-unit-adapter";
import { plotlyChartUnitAdapter } from "@/selection/chart-units/plotly-chart-unit-adapter";
import type { LensTarget, ViewportPoint } from "@/types";

export type ChartUnitRegistry = {
  adapters: readonly ChartUnitAdapter[];
  resolve: (element: Element, point?: ViewportPoint, target?: LensTarget) => ChartUnitMatch | null;
};

export const defaultChartUnitAdapters: readonly ChartUnitAdapter[] = Object.freeze(
  [
    metadataChartUnitAdapter,
    altairVegaChartUnitAdapter,
    plotlyChartUnitAdapter,
    matplotlibChartUnitAdapter,
    genericSvgChartUnitAdapter,
  ].sort(compareChartUnitAdapters),
);

export function createChartUnitRegistry(
  adapters: readonly ChartUnitAdapter[] = defaultChartUnitAdapters,
): ChartUnitRegistry {
  const orderedAdapters = Object.freeze([...adapters].sort(compareChartUnitAdapters));
  return {
    adapters: orderedAdapters,
    resolve: (element, point, target) => {
      const candidates = [element, ...elementsAtPointCrossingShadow(point)];
      const seen = new Set<Element>();
      const matches: ChartUnitMatch[] = [];

      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        for (const adapter of orderedAdapters) {
          if (!adapterSupportsTarget(adapter, target)) continue;
          const match = adapter.match({ element: candidate, point, target });
          if (match) matches.push(match);
        }
      }

      return matches.sort((left, right) => right.score - left.score)[0] ?? null;
    },
  };
}

export const defaultChartUnitRegistry = createChartUnitRegistry();

export function resolveChartUnit(
  element: Element,
  point?: ViewportPoint,
  target?: LensTarget,
): ChartUnitMatch | null {
  return defaultChartUnitRegistry.resolve(element, point, target);
}

function adapterSupportsTarget(adapter: ChartUnitAdapter, target?: LensTarget): boolean {
  const library = target?.chart?.library;
  if (!library || !adapter.libraries) return true;
  return adapter.libraries.includes(library);
}

function compareChartUnitAdapters(left: ChartUnitAdapter, right: ChartUnitAdapter): number {
  return right.priority - left.priority;
}
