import type { LensChartLibrary, LensChartPart, LensTarget, ViewportPoint } from "@/types";

export type ChartUnitMatch = {
  element: Element;
  unit: LensChartPart;
  score: number;
  context?: Record<string, unknown>;
};

export type ChartUnitContext = {
  element: Element;
  point?: ViewportPoint;
  target?: LensTarget;
};

export type ChartUnitAdapter = {
  id: string;
  priority: number;
  libraries?: LensChartLibrary[];
  match: (context: ChartUnitContext) => ChartUnitMatch | null;
};

export type ChartUnitAdapterInit = Omit<ChartUnitAdapter, "priority"> & {
  priority?: number;
};

export function defineChartUnitAdapter<Adapter extends ChartUnitAdapterInit>(
  adapter: Adapter,
): Adapter & ChartUnitAdapter {
  return { ...adapter, priority: adapter.priority ?? 0 };
}
