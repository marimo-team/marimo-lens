import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { markedLensElement } from "@/selection/selection-scope";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";

export const markedTargetPlugin = defineSelectionPlugin({
  id: "marked-target",
  surface: "marked",
  priority: 1000,
  select: ({ element, targets }) => {
    const marker = markedLensElement(element);
    const variable = marker?.getAttribute("data-marimo-lens-var");
    if (!variable) return null;
    const target =
      targets.find(
        (candidate) => candidate.variable === variable || candidate.label === variable,
      ) ?? null;
    if (!target) return null;
    return {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        element: marker ?? element,
        sourceElement: element,
        kind: "target",
        granularity: "target",
        hitKind: "marked-target",
        data: {
          markerVariable: variable,
          surface: "marimo-lens-marker",
        },
      }),
      score: 100,
    };
  },
});
