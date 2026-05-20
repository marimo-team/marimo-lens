import { identifyElement } from "@/lib/element-identification";
import { elementsAtPointCrossingShadow } from "@/lib/shadow-dom";
import type { LensTarget, ResolvedHover, ViewportPoint } from "@/types";
import type {
  SelectionContext,
  SelectionMatch,
  SelectionPlugin,
} from "@/selection/selection-plugin";
import { defaultSelectionPlugins } from "@/selection/plugins/default-selection-plugins";
import {
  outputCellIdFor,
  preferredSelectionRank,
  selectionScopeFor,
  targetContext,
} from "@/selection/selection-scope";
import {
  chartPartFromSemanticSelection,
  columnFromSemanticSelection,
  semanticAnchorElement,
  semanticHighlightElement,
  semanticHighlightRect,
  surfaceSemanticSelection,
} from "@/selection/semantic-selection";

type SelectionCandidate = {
  plugin: SelectionPlugin;
  match: SelectionMatch;
  resolved: ResolvedHover;
};

const orderedSelectionPlugins = [...defaultSelectionPlugins].sort(
  (a, b) => b.priority - a.priority,
);

export function resolveElementSelection(
  element: Element,
  targets: LensTarget[],
  point?: ViewportPoint,
): ResolvedHover | null {
  const scope = selectionScopeFor(element, targets);
  const context: SelectionContext = { ...scope, element, point };
  const candidates: SelectionCandidate[] = [];
  for (const plugin of orderedSelectionPlugins) {
    const match = plugin.select(context);
    if (match) {
      const resolved = toResolvedHover(plugin, element, match, scope.displayCellId);
      if (resolved) {
        candidates.push({ match, plugin, resolved });
      }
    }
  }
  candidates.sort((a, b) => compareCandidates(a.plugin, a.match, b.plugin, b.match));
  return candidates[0]?.resolved ?? null;
}

export function resolvePointSelection(
  point: ViewportPoint,
  targets: LensTarget[],
): ResolvedHover | null {
  for (const element of elementsAtPointCrossingShadow(point)) {
    const resolved = resolveElementSelection(element, targets, point);
    if (resolved) return resolved;
  }
  return null;
}

export function targetElementForSelection(
  target: LensTarget,
  targets: LensTarget[],
): Element | null {
  const scope = {
    allTargets: targets,
    targets,
    displayCellId: null,
    displayTargets: [],
  };
  for (const plugin of orderedSelectionPlugins) {
    const element = plugin.previewElement?.({ ...scope, target }) ?? null;
    if (element) return element;
  }
  return null;
}

export function hoverForTargetSelection(
  target: LensTarget,
  element: Element,
  targets: LensTarget[],
): ResolvedHover | null {
  const scope = selectionScopeFor(element, targets);
  for (const plugin of orderedSelectionPlugins) {
    const match = plugin.preview?.({ ...scope, target, element }) ?? null;
    const resolved = match ? toResolvedHover(plugin, element, match, scope.displayCellId) : null;
    if (resolved) return resolved;
  }
  return toResolvedHover(
    { id: "target-preview", surface: "selector" },
    element,
    {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        element,
        kind: "target",
        granularity: "target",
        hitKind: "target-preview",
        data: targetContext(target),
      }),
    },
    outputCellIdFor(element),
  );
}

function compareCandidates(
  leftPlugin: SelectionPlugin,
  left: SelectionMatch,
  rightPlugin: SelectionPlugin,
  right: SelectionMatch,
): number {
  const leftRank = preferredSelectionRank(left.target, leftPlugin.surface);
  const rightRank = preferredSelectionRank(right.target, rightPlugin.surface);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const scoreDifference = (right.score ?? 0) - (left.score ?? 0);
  if (scoreDifference !== 0) return scoreDifference;

  return rightPlugin.priority - leftPlugin.priority;
}

function toResolvedHover(
  plugin: Pick<SelectionPlugin, "id" | "surface">,
  sourceElement: Element,
  match: SelectionMatch,
  scopedDisplayCellId: string | null,
): ResolvedHover | null {
  const element =
    semanticHighlightElement(match.semanticSelection.highlight) ??
    semanticAnchorElement(match.semanticSelection) ??
    sourceElement;
  const rect =
    semanticHighlightRect(match.semanticSelection.highlight) ?? element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const { name, path } = identifyElement(sourceElement);
  const context = {
    ...targetContext(match.target),
    ...match.semanticSelection.data,
  };
  return {
    element,
    rect,
    target: match.target,
    semanticSelection: match.semanticSelection,
    column: columnFromSemanticSelection(match.semanticSelection, match.target),
    chartPart: chartPartFromSemanticSelection(match.semanticSelection),
    displayCellId: match.displayCellId ?? scopedDisplayCellId,
    elementName: name,
    elementPath: path,
    selection: {
      adapter: plugin.surface,
      kind: match.semanticSelection.kind,
      score: match.score,
    },
    context,
  };
}
