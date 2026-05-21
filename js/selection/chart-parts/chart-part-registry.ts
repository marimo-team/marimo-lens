import type { ChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";
import type { ChartPartMatch } from "@/selection/chart-parts/chart-part-adapter";
import type { LensTarget, ViewportPoint } from "@/types";

import { elementsAtPointCrossingShadow } from "@/lib/shadow-dom";
import { altairVegaChartPartAdapter } from "@/selection/chart-parts/altair-vega-chart-part-adapter";
import { matchingChartLibraries } from "@/selection/chart-parts/chart-library-matching";
import { genericSvgChartPartAdapter } from "@/selection/chart-parts/generic-svg-chart-part-adapter";
import { matplotlibChartPartAdapter } from "@/selection/chart-parts/matplotlib-chart-part-adapter";
import { metadataChartPartAdapter } from "@/selection/chart-parts/metadata-chart-part-adapter";
import { plotlyChartPartAdapter } from "@/selection/chart-parts/plotly-chart-part-adapter";

export type ChartPartRegistry = {
  adapters: readonly ChartPartAdapter[];
  resolve: (element: Element, point?: ViewportPoint, target?: LensTarget) => ChartPartMatch | null;
};

export const defaultChartPartAdapters: readonly ChartPartAdapter[] = Object.freeze(
  [
    metadataChartPartAdapter,
    altairVegaChartPartAdapter,
    plotlyChartPartAdapter,
    matplotlibChartPartAdapter,
    genericSvgChartPartAdapter,
  ].sort(compareChartPartAdapters),
);

export function createChartPartRegistry(
  adapters: readonly ChartPartAdapter[] = defaultChartPartAdapters,
): ChartPartRegistry {
  const orderedAdapters = Object.freeze([...adapters].sort(compareChartPartAdapters));
  return {
    adapters: orderedAdapters,
    resolve: (element, point, target) => {
      const candidates = [element, ...elementsAtPointCrossingShadow(point)];
      const seen = new Set<Element>();
      const matches: ChartPartMatch[] = [];

      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        for (const adapter of orderedAdapters) {
          if (!adapterSupportsTarget(adapter, target)) continue;
          const match = adapter.match({ element: candidate, point, target });
          if (match) {
            matches.push({
              ...match,
              adapterId: adapter.id,
              context: {
                adapterId: adapter.id,
                evidenceSource: adapter.id,
                ...match.context,
              },
            });
          }
        }
      }

      return matches.sort((left, right) => right.score - left.score)[0] ?? null;
    },
  };
}

export const defaultChartPartRegistry = createChartPartRegistry();

export function resolveChartPart(
  element: Element,
  point?: ViewportPoint,
  target?: LensTarget,
): ChartPartMatch | null {
  return defaultChartPartRegistry.resolve(element, point, target);
}

const SPECIALIZED_CHART_LIBRARIES = new Set([
  "altair",
  "marimo-data-explorer",
  "matplotlib",
  "plotly",
  "vega",
]);

function adapterSupportsTarget(adapter: ChartPartAdapter, target?: LensTarget): boolean {
  const library = target?.chart?.library;
  if (adapter.id === "generic-svg") {
    if (!library) return true;
    const normalized = normalizeLibrary(library);
    return normalized === "visual" || !SPECIALIZED_CHART_LIBRARIES.has(normalized);
  }
  if (!library || !adapter.libraries) return true;
  return adapter.libraries.some((adapterLibrary) =>
    matchingChartLibraries(adapterLibrary, library),
  );
}

function compareChartPartAdapters(left: ChartPartAdapter, right: ChartPartAdapter): number {
  return right.priority - left.priority;
}

function normalizeLibrary(value: string): string {
  return value.trim().toLowerCase();
}
