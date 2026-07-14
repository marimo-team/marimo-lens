import type { AnnotationDraft, PopupState } from "@/types";

import { createAnnotationAnchor } from "@/lib/annotation-anchors";
import { clamp } from "@/lib/dom-geometry";
import { semanticHighlightRect, serializeSemanticSelection } from "@/selection/semantic-selection";

type DraftInput = {
  popup: PopupState;
  comment: string;
};

export function createFeedbackDraft({ popup, comment }: DraftInput): AnnotationDraft {
  const { target, column, displayCellId } = popup.hover;
  const semanticSelection = serializeSemanticSelection(popup.hover.semanticSelection);
  const rect = semanticHighlightRect(popup.hover.semanticSelection.highlight) ?? popup.hover.rect;
  const point = {
    x: clamp(popup.x, rect.left, rect.right),
    y: clamp(popup.y, rect.top, rect.bottom),
  };
  const targetSnapshot = cloneContractValue(target);
  const domEvidence = {
    element: popup.hover.elementName,
    elementPath: popup.hover.elementPath,
    documentPoint: {
      x: point.x + window.scrollX,
      y: point.y + window.scrollY,
    },
    boundingBox: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
  };
  return {
    targetId: target.id,
    targetLabel: target.label,
    targetSnapshot,
    variable: target.variable,
    kind: target.kind,
    column: column?.name,
    columnDtype: column?.dtype,
    chartPart: popup.hover.chartPart ?? null,
    cellId: target.cellId,
    displayCellId,
    comment,
    element: domEvidence.element,
    elementPath: domEvidence.elementPath,
    documentX: domEvidence.documentPoint.x,
    documentY: domEvidence.documentPoint.y,
    boundingBox: domEvidence.boundingBox,
    domEvidence,
    anchor: createAnnotationAnchor(popup.hover, point),
    semanticSelection,
    context: popup.hover.context ? { selectionContext: popup.hover.context } : undefined,
  };
}

function cloneContractValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
