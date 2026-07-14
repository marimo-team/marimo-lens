import type { LensTarget, SelectionSurface, SemanticSelection, ViewportPoint } from "@/types";

export type SelectionScope = {
  readonly allTargets: LensTarget[];
  readonly targets: LensTarget[];
  readonly displayCellId: string | null;
  readonly displayTargets: LensTarget[];
};

export type SelectionContext = SelectionScope & {
  readonly element: Element;
  readonly point?: ViewportPoint;
};

export type TargetPreviewContext = SelectionScope & {
  readonly target: LensTarget;
};

export type SelectionMatch = {
  target: LensTarget;
  semanticSelection: SemanticSelection;
  displayCellId?: string | null;
  score?: number;
};

export type SelectionPlugin = {
  id: string;
  surface: SelectionSurface;
  priority: number;
  select: (context: SelectionContext) => SelectionMatch | null;
  previewElement?: (context: TargetPreviewContext) => Element | null;
  preview?: (context: TargetPreviewContext & { element: Element }) => SelectionMatch | null;
};

export const defineSelectionPlugin = <Plugin extends SelectionPlugin>(plugin: Plugin): Plugin =>
  plugin;
