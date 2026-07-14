import type { LensTarget, ViewportPoint } from "@/types";

import { isDocumentTarget } from "@/lib/column-targeting";
import { defineSelectionPlugin } from "@/selection/selection-plugin";
import { surfaceSemanticSelection } from "@/selection/semantic-selection";
import { surfaceAtElementOrPoint } from "@/selection/surface-targeting";

const DOCUMENT_SELECTOR =
  "iframe,embed,object,[data-marimo-document],[data-mime='application/pdf'],[data-mime='text/markdown'],[data-mime='text/html']";

export const documentSelectionPlugin = defineSelectionPlugin({
  id: "document",
  surface: "document",
  priority: 820,
  select: ({ displayCellId, displayTargets, element, point, targets }) => {
    const surface = documentSurface(element, point);
    const target = surface
      ? bestDocumentTarget(targets.filter(isDocumentTarget))
      : fallbackDisplayDocumentTarget(displayTargets);
    if (!target) return null;
    const selectionElement = surface ?? element;
    return {
      target,
      semanticSelection: surfaceSemanticSelection({
        target,
        surface: "document",
        element: selectionElement,
        sourceElement: element,
        kind: "document-surface",
        granularity: "surface",
        hitKind: "document-surface",
        selector: describeSurface(selectionElement),
        data: {
          displayCellId,
          surface: "document",
          surfaceSelector: describeSurface(selectionElement),
        },
      }),
      displayCellId,
      score: 74,
    };
  },
});

function documentSurface(element: Element, point?: ViewportPoint): Element | null {
  return surfaceAtElementOrPoint(element, DOCUMENT_SELECTOR, point);
}

function fallbackDisplayDocumentTarget(targets: LensTarget[]): LensTarget | null {
  return bestDocumentTarget(targets.filter(isDocumentTarget));
}

function bestDocumentTarget(targets: LensTarget[]): LensTarget | null {
  const primaryTargets = targets.filter((target) => target.kind !== "output");
  if (primaryTargets.length === 1) return primaryTargets[0];
  if (primaryTargets.length > 1) return null;
  return singleTarget(targets);
}

function singleTarget(targets: LensTarget[]): LensTarget | null {
  return targets.length === 1 ? targets[0] : null;
}

function describeSurface(element: Element): string {
  if (element.id) return `#${element.id}`;
  const mime = element.getAttribute("data-mime");
  if (mime) return `[data-mime="${mime}"]`;
  return element.tagName.toLowerCase();
}
