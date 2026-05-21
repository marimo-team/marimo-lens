import type {
  LensChartLibrary,
  LensChartPart,
  LensTarget,
  SelectionHighlight,
  ViewportPoint,
} from "@/types";

export type ChartPartMatch = {
  element: Element;
  part: LensChartPart;
  score: number;
  adapterId?: string;
  highlight?: SelectionHighlight;
  anchorData?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export type ChartPartContext = {
  element: Element;
  point?: ViewportPoint;
  target?: LensTarget;
};

export type ChartPartAdapter = {
  id: string;
  priority: number;
  libraries?: LensChartLibrary[];
  match: (context: ChartPartContext) => ChartPartMatch | null;
};

export type ChartPartAdapterInit = Omit<ChartPartAdapter, "priority"> & {
  priority?: number;
};

export function defineChartPartAdapter<Adapter extends ChartPartAdapterInit>(
  adapter: Adapter,
): Adapter & ChartPartAdapter {
  return { ...adapter, priority: adapter.priority ?? 0 };
}
