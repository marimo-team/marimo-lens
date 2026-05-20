import { isVisualTarget } from "@/lib/column-targeting";
import { closestCrossingShadow } from "@/lib/shadow-dom";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";

const VISUAL_SELECTOR = "svg,canvas,.vega-embed,.plotly,.js-plotly-plot";

export const visualSelectionPlugin = defineSelectionPlugin({
  id: "visual-surface",
  surface: "visual-surface",
  priority: 875,
  select: ({ element, targets }) => {
    const surface = closestCrossingShadow(element, VISUAL_SELECTOR);
    if (!surface) return null;
    const visualTargets = targets.filter(isVisualTarget);
    if (visualTargets.length !== 1) return null;
    return {
      target: visualTargets[0],
      semanticSelection: surfaceSemanticSelection({
        target: visualTargets[0],
        element: surface,
        sourceElement: element,
        kind: "visual-surface",
        granularity: "surface",
        hitKind: "visual-surface",
        selector: describeSurface(surface),
        data: {
          surface: "visual-surface",
          surfaceSelector: describeSurface(surface),
        },
      }),
      score: 76,
    };
  },
});

function describeSurface(element: Element): string {
  if (element.id) return `#${element.id}`;
  for (const className of element.classList) {
    if (className) return `.${className}`;
  }
  return element.tagName.toLowerCase();
}
