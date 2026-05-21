import type { AnnotationDraft, LensAnnotation, PopupState } from "@/types";

import { createAnnotationAnchor } from "@/lib/annotation-anchors";
import { semanticHighlightRect, serializeSemanticSelection } from "@/selection/semantic-selection";

type DraftInput = {
  popup: PopupState;
  comment: string;
  intent: LensAnnotation["intent"];
  severity: LensAnnotation["severity"];
};

export function createFeedbackDraft({
  popup,
  comment,
  intent,
  severity,
}: DraftInput): AnnotationDraft {
  const { target, column, displayCellId } = popup.hover;
  const semanticSelection = serializeSemanticSelection(popup.hover.semanticSelection);
  const rect = semanticHighlightRect(popup.hover.semanticSelection.highlight) ?? popup.hover.rect;
  const targetSnapshot = cloneContractValue(target);
  const domEvidence = {
    element: popup.hover.elementName,
    elementPath: popup.hover.elementPath,
    documentPoint: {
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.top + rect.height / 2 + window.scrollY,
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
    intent,
    severity,
    element: domEvidence.element,
    elementPath: domEvidence.elementPath,
    documentX: domEvidence.documentPoint.x,
    documentY: domEvidence.documentPoint.y,
    boundingBox: domEvidence.boundingBox,
    domEvidence,
    anchor: createAnnotationAnchor(popup.hover),
    semanticSelection,
    context: popup.hover.context ? { selectionContext: popup.hover.context } : undefined,
  };
}

function cloneContractValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
