import type { SelectionAnchor } from "@marimo-lens/protocol";

import { useEffect, type Dispatch, type RefObject } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { SelectionMotion, UiAction, UiState, WorkflowState } from "@/selection/state";

import { outputFromFrame, parentViewportPoint } from "@/notebook/interaction-documents";
import {
  deepestElementFromEvent,
  outputCellFromElement,
  outputCellFromEvent,
} from "@/notebook/output-root";
import { handleLensEscape } from "@/selection/escape";
import { gestureAnchor, normalizedPoint } from "@/selection/state";
import { focusDock, focusListTrigger, focusSelectionOrDock } from "@/ui/focus";

export type BeginSelection = (
  outputCellId: string,
  output: HTMLElement,
  anchor: SelectionAnchor,
  detailElement: Element,
  motion?: SelectionMotion,
) => void;

export function useDocumentInteractions(options: {
  workflow: WorkflowState;
  uiRef: RefObject<UiState>;
  dispatch: Dispatch<UiAction>;
  dom: NotebookDomAdapter;
  beginSelection: BeginSelection;
  canceledPointerIds: RefObject<Set<number>>;
  cancelAdjustment: () => boolean;
}): void {
  const { workflow, uiRef, dispatch, dom, beginSelection, canceledPointerIds, cancelAdjustment } =
    options;
  const interactionActive = workflow.mode === "armed" || workflow.mode === "dragging";

  useEffect(() => {
    if (interactionActive) dom.document.documentElement.dataset.marimoLensArmed = "true";
    else delete dom.document.documentElement.dataset.marimoLensArmed;

    const surfaceOptions = {
      includeOutputFrames: interactionActive,
      lockSelectionGestures: interactionActive,
    };
    const detachSurfaces = dom.observeInteractionSurfaces(surfaceOptions, (surface) => {
      const outputForEvent = (event: Event) =>
        surface.frame ? outputFromFrame(surface.frame) : outputCellFromEvent(event);

      const onPointerDown = (event: PointerEvent) => {
        const workflow = uiRef.current.workflow;
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
        const workflow = uiRef.current.workflow;
        if (workflow.mode === "armed") {
          dispatch({ type: "focusOutput", outputCellId: outputForEvent(event)?.id ?? null });
        } else if (workflow.mode === "dragging" && workflow.pointerId === event.pointerId) {
          event.preventDefault();
          dispatch({
            type: "moveDrag",
            pointerId: event.pointerId,
            point: parentViewportPoint(event, surface.frame),
          });
        }
      };

      const onPointerUp = (event: PointerEvent) => {
        if (canceledPointerIds.current.delete(event.pointerId)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const workflow = uiRef.current.workflow;
        if (workflow.mode !== "dragging" || workflow.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const end = parentViewportPoint(event, surface.frame);
        const anchor = gestureAnchor(workflow.output.element, workflow.start, end);
        const frame = surface.frame ?? dom.iframeAtPoint(end, workflow.output);
        const candidate = frame ?? dom.deepestElementAtPoint(end.x, end.y);
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
        const workflow = uiRef.current.workflow;
        if (workflow.mode !== "dragging" || workflow.pointerId !== event.pointerId) return;
        dispatch({ type: "arm" });
      };

      const onKeyDown = (event: KeyboardEvent) => {
        const workflow = uiRef.current.workflow;
        handleLensEscape(event, {
          state: uiRef.current,
          dispatch,
          cancelDrag: (pointerId, output) => {
            canceledPointerIds.current.add(pointerId);
            if (output.hasPointerCapture(pointerId)) output.releasePointerCapture(pointerId);
          },
          cancelAdjustment,
          focusSelection: (selectionId) => focusSelectionOrDock(dom, selectionId),
          focusDock: () => focusDock(dom),
          focusListTrigger: () => focusListTrigger(dom),
        });
        if (event.defaultPrevented || workflow.mode !== "armed") return;
        if (event.key === "Tab") {
          dispatch({ type: "disarm" });
          return;
        }
        const target = eventTargetElement(event, surface.document);
        const lensUi = target?.closest("[data-marimo-lens-ui]");
        if (lensUi && !target?.closest("[data-ml-select]")) return;
        navigateOutputs(dom, event, workflow, beginSelection, dispatch);
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
      if (interactionActive) delete dom.document.documentElement.dataset.marimoLensArmed;
    };
  }, [
    beginSelection,
    canceledPointerIds,
    cancelAdjustment,
    dispatch,
    dom,
    interactionActive,
    uiRef,
  ]);
}

function navigateOutputs(
  dom: NotebookDomAdapter,
  event: KeyboardEvent,
  workflow: Extract<WorkflowState, { mode: "armed" }>,
  beginSelection: BeginSelection,
  dispatch: Dispatch<UiAction>,
): void {
  const outputs = dom.listOutputCells();
  if (outputs.length === 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const current = outputs.findIndex((output) => output.id === workflow.activeOutputCellId);
    const backwards = event.key === "ArrowUp";
    const next =
      current < 0
        ? backwards
          ? outputs.length - 1
          : 0
        : (current + (backwards ? -1 : 1) + outputs.length) % outputs.length;
    const output = outputs[next];
    if (!output) return;
    output.element.scrollIntoView({ block: "nearest" });
    dispatch({ type: "focusOutput", outputCellId: output.id });
    dispatch({
      type: "announce",
      message: outputAnnouncement(output.element, next, outputs.length),
    });
  } else if (event.key === "Enter") {
    event.preventDefault();
    const output =
      outputs.find((candidate) => candidate.id === workflow.activeOutputCellId) ?? outputs[0];
    if (!output) return;
    const rect = output.element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const detail =
      dom.iframeAtPoint(point, output) ??
      dom.deepestElementAtPoint(point.x, point.y) ??
      output.element;
    beginSelection(
      output.id,
      output.element,
      {
        kind: "point",
        ...normalizedPoint(output.element, point),
      },
      detail,
      "instant",
    );
  }
}

function outputAnnouncement(output: HTMLElement, index: number, count: number): string {
  const headingSelector = "h1, h2, h3, h4, h5, h6, [role='heading']";
  const heading = output.matches(headingSelector)
    ? output
    : output.querySelector<HTMLElement>(headingSelector);
  const labelled = output.matches("[aria-label]")
    ? output
    : output.querySelector<HTMLElement>("[aria-label]");
  const label = normalizeLabel(heading?.textContent ?? labelled?.getAttribute("aria-label"));
  return label ? `Output ${index + 1} of ${count}, ${label}.` : `Output ${index + 1} of ${count}.`;
}

function normalizeLabel(value: string | null | undefined): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 79)}…`;
}

function eventTargetElement(event: Event, ownerDocument: Document): Element | null {
  const ownerWindow = ownerDocument.defaultView;
  return ownerWindow && event.target instanceof ownerWindow.Element ? event.target : null;
}
