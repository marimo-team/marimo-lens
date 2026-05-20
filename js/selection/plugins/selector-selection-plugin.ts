import { closestCrossingShadow, queryFirstCrossingShadow } from "@/lib/shadow-dom";
import { defineSelectionPlugin, type SelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";
import type { LensTarget } from "@/types";

type SelectorPluginOptions = {
  id: string;
  priority: number;
};

export function createSelectorSelectionPlugin(options: SelectorPluginOptions): SelectionPlugin {
  return defineSelectionPlugin({
    id: options.id,
    surface: "selector",
    priority: options.priority,
    select: ({ element, targets }) => {
      const matches = matchingTargets(element, targets);
      if (matches.length !== 1) return null;
      const match = matches[0];
      return {
        target: match.target,
        semanticSelection: surfaceSemanticSelection({
          target: match.target,
          element,
          sourceElement: element,
          kind: "target",
          granularity: "target",
          hitKind: "target-selector",
          selector: match.selector,
          highlight: {
            kind: "elements",
            elements: [closestCrossingShadow(element, match.selector) ?? element],
            fallbackElement: element,
            strategy: "target-selector",
          },
          data: {
            surface: "selector",
            selector: match.selector,
          },
        }),
        score: 70,
      };
    },
    previewElement: ({ target }) => {
      for (const selector of target.selectors ?? []) {
        const element = queryFirstCrossingShadow(document, selector);
        if (element) return element;
      }
      return null;
    },
    preview: ({ target, element }) => {
      const selector = firstMatchingSelector(element, target.selectors ?? []);
      if (!selector) return null;
      return {
        target,
        semanticSelection: surfaceSemanticSelection({
          target,
          element,
          kind: "target",
          granularity: "target",
          hitKind: "target-selector-preview",
          selector,
          data: {
            surface: "selector",
            selector,
          },
        }),
        score: 68,
      };
    },
  });
}

function matchingTargets(element: Element, targets: readonly LensTarget[]) {
  return targets.flatMap((target) => {
    const selector = firstMatchingSelector(element, target.selectors ?? []);
    return selector ? [{ target, selector }] : [];
  });
}

function firstMatchingSelector(element: Element, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    if (closestCrossingShadow(element, selector)) return selector;
  }
  return null;
}
