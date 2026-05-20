import { isDocumentTarget } from "@/lib/column-targeting";
import { closestCrossingShadow } from "@/lib/shadow-dom";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";

const DOCUMENT_SELECTOR =
  "iframe,embed,object,[data-marimo-document],[data-mime='application/pdf'],[data-mime='text/markdown'],[data-mime='text/html']";

export const documentSelectionPlugin = defineSelectionPlugin({
  id: "document",
  surface: "document",
  priority: 820,
  select: ({ element, targets }) => {
    const surface = closestCrossingShadow(element, DOCUMENT_SELECTOR);
    if (!surface) return null;
    const documentTargets = targets.filter(isDocumentTarget);
    if (documentTargets.length !== 1) return null;
    return {
      target: documentTargets[0],
      semanticSelection: surfaceSemanticSelection({
        target: documentTargets[0],
        element: surface,
        sourceElement: element,
        kind: "document-surface",
        granularity: "surface",
        hitKind: "document-surface",
        selector: describeSurface(surface),
        data: {
          surface: "document",
          surfaceSelector: describeSurface(surface),
        },
      }),
      score: 74,
    };
  },
});

function describeSurface(element: Element): string {
  if (element.id) return `#${element.id}`;
  const mime = element.getAttribute("data-mime");
  if (mime) return `[data-mime="${mime}"]`;
  return element.tagName.toLowerCase();
}
