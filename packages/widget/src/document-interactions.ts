import { useEffect, type Dispatch, type RefObject } from "react";

import type { SelectionAnchor } from "@/contracts";
import type { UiAction, UiState, WorkflowState } from "@/state";

import {
  deepestElementAtPoint,
  deepestElementFromEvent,
  listOutputCells,
  outputCellFromElement,
  outputCellFromEvent,
} from "@/capture/output-root";
import { handleLensEscape } from "@/escape";
import { focusDock, focusListTrigger, focusSelectionOrDock } from "@/focus";
import {
  iframeAtPoint,
  observeInteractionSurfaces,
  outputFromFrame,
  parentViewportPoint,
} from "@/interaction-documents";
import { gestureAnchor, normalizedPoint } from "@/state";

export type BeginSelection = (
  outputCellId: string,
  output: HTMLElement,
  anchor: SelectionAnchor,
  detailElement: Element,
) => void;

export function useDocumentInteractions(options: {
  workflow: WorkflowState;
  uiRef: RefObject<UiState>;
  dispatch: Dispatch<UiAction>;
  beginSelection: BeginSelection;
  canceledPointerIds: RefObject<Set<number>>;
  cancelAdjustment: () => boolean;
}): void {
  const { workflow, uiRef, dispatch, beginSelection, canceledPointerIds, cancelAdjustment } =
    options;

  useEffect(() => {
    const armed = workflow.mode === "armed" || workflow.mode === "dragging";
    if (armed) document.documentElement.dataset.marimoLensArmed = "true";
    else delete document.documentElement.dataset.marimoLensArmed;

    const detachSurfaces = observeInteractionSurfaces(armed, (surface) => {
      const outputForEvent = (event: Event) =>
        surface.frame ? outputFromFrame(surface.frame) : outputCellFromEvent(event);

      const onPointerDown = (event: PointerEvent) => {
        if (workflow.mode !== "armed" || event.button !== 0) return;
        const output = outputForEvent(event);
        if (!output) return;
        const point = parentViewportPoint(event, surface.frame);
        canceledPointerIds.current.delete(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
        try {
          output.element.setPointerCapture(event.pointerId);
        } catch {
          // Cross-document pointers remain tracked by listeners on both documents.
        }
        dispatch({ type: "startDrag", output, pointerId: event.pointerId, point });
      };

      const onPointerMove = (event: PointerEvent) => {
        const point = parentViewportPoint(event, surface.frame);
        if (workflow.mode === "armed") {
          dispatch({ type: "focusOutput", outputCellId: outputForEvent(event)?.id ?? null });
        } else if (workflow.mode === "dragging" && workflow.pointerId === event.pointerId) {
          event.preventDefault();
          dispatch({ type: "moveDrag", pointerId: event.pointerId, point });
        }
      };

      const onPointerUp = (event: PointerEvent) => {
        if (canceledPointerIds.current.delete(event.pointerId)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (workflow.mode !== "dragging" || workflow.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const end = parentViewportPoint(event, surface.frame);
        const anchor = gestureAnchor(workflow.output.element, workflow.start, end);
        const frame = surface.frame ?? iframeAtPoint(end, workflow.output);
        const candidate = frame ?? deepestElementAtPoint(end.x, end.y);
        const detail =
          candidate && outputCellFromElement(candidate)?.id === workflow.output.id
            ? candidate
            : surface.frame
              ? surface.frame
              : deepestElementFromEvent(event, workflow.output.element);
        beginSelection(workflow.output.id, workflow.output.element, anchor, detail);
        if (workflow.output.element.hasPointerCapture(event.pointerId)) {
          workflow.output.element.releasePointerCapture(event.pointerId);
        }
      };

      const onPointerCancel = (event: PointerEvent) => {
        canceledPointerIds.current.delete(event.pointerId);
        if (workflow.mode !== "dragging" || workflow.pointerId !== event.pointerId) return;
        dispatch({ type: "arm" });
      };

      const onKeyDown = (event: KeyboardEvent) => {
        handleLensEscape(event, {
          state: uiRef.current,
          dispatch,
          cancelDrag: (pointerId, output) => {
            canceledPointerIds.current.add(pointerId);
            if (output.hasPointerCapture(pointerId)) output.releasePointerCapture(pointerId);
          },
          cancelAdjustment,
          focusSelection: focusSelectionOrDock,
          focusDock,
          focusListTrigger,
        });
        if (event.defaultPrevented || workflow.mode !== "armed") return;
        const lensUi =
          event.target instanceof Element && event.target.closest("[data-marimo-lens-ui]");
        if (lensUi && !(event.target as Element).closest("[data-ml-select]")) return;
        navigateOutputs(event, workflow, beginSelection, dispatch);
      };

      surface.document.addEventListener("pointerdown", onPointerDown, true);
      surface.document.addEventListener("pointermove", onPointerMove, true);
      surface.document.addEventListener("pointerup", onPointerUp, true);
      surface.document.addEventListener("pointercancel", onPointerCancel, true);
      surface.document.addEventListener("keydown", onKeyDown, true);
      return () => {
        surface.document.removeEventListener("pointerdown", onPointerDown, true);
        surface.document.removeEventListener("pointermove", onPointerMove, true);
        surface.document.removeEventListener("pointerup", onPointerUp, true);
        surface.document.removeEventListener("pointercancel", onPointerCancel, true);
        surface.document.removeEventListener("keydown", onKeyDown, true);
      };
    });

    return () => {
      detachSurfaces();
      if (armed) delete document.documentElement.dataset.marimoLensArmed;
    };
  }, [beginSelection, canceledPointerIds, cancelAdjustment, dispatch, uiRef, workflow]);
}

function navigateOutputs(
  event: KeyboardEvent,
  workflow: Extract<WorkflowState, { mode: "armed" }>,
  beginSelection: BeginSelection,
  dispatch: Dispatch<UiAction>,
): void {
  const outputs = listOutputCells();
  if (outputs.length === 0) return;
  if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Tab"].includes(event.key)) {
    event.preventDefault();
    const current = outputs.findIndex((output) => output.id === workflow.activeOutputCellId);
    const backwards =
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft" ||
      (event.key === "Tab" && event.shiftKey);
    const next =
      current < 0
        ? backwards
          ? outputs.length - 1
          : 0
        : (current + (backwards ? -1 : 1) + outputs.length) % outputs.length;
    outputs[next]?.element.scrollIntoView({ block: "nearest" });
    dispatch({ type: "focusOutput", outputCellId: outputs[next]?.id ?? null });
  } else if (event.key === "Enter") {
    event.preventDefault();
    const output =
      outputs.find((candidate) => candidate.id === workflow.activeOutputCellId) ?? outputs[0];
    if (!output) return;
    const rect = output.element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const detail =
      iframeAtPoint(point, output) ?? deepestElementAtPoint(point.x, point.y) ?? output.element;
    beginSelection(
      output.id,
      output.element,
      {
        kind: "point",
        ...normalizedPoint(output.element, point),
      },
      detail,
    );
  }
}
