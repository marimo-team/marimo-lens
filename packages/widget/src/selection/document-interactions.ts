import type { SelectionAnchor, SelectionTarget } from "@marimo-lens/protocol";

import { useCallback, useEffect, useRef, type Dispatch, type RefObject } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { TargetSurface } from "@/notebook/target-surface";
import type { SelectionMotion, UiAction, UiState, WorkflowState } from "@/selection/state";

import { createSelectionCursor, parentViewportPoint } from "@/notebook/interaction-documents";
import { deepestElementFromEvent } from "@/notebook/output-root";
import { targetInfo } from "@/notebook/target-info";
import { anchorCenter, viewportToContent } from "@/selection/anchor";
import { gestureAnchor } from "@/selection/state";
import { focusDock, focusListTrigger, focusSelectionOrDock } from "@/ui/focus";

export type BeginSelection = (
  target: SelectionTarget,
  element: HTMLElement,
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
  cancelAdjustment: () => boolean;
}): void {
  const { workflow, uiRef, dispatch, dom, beginSelection, cancelAdjustment } = options;
  // Escape cancels a drag before its release, which must not select.
  const canceledPointerIds = useRef(new Set<number>());
  const interactionActive = workflow.mode === "armed" || workflow.mode === "dragging";
  const clickGuardCleanup = useRef<(() => void) | null>(null);
  const clearClickGuard = useCallback(() => {
    clickGuardCleanup.current?.();
    clickGuardCleanup.current = null;
  }, []);
  const guardNextClick = useCallback(
    (document: Document) => {
      clearClickGuard();
      const window = document.defaultView;
      let fallback: number | null = null;
      const onClick = (event: Event) => {
        clearClickGuard();
        event.preventDefault();
        event.stopPropagation();
      };
      const clickTarget = window ?? document;
      clickTarget.addEventListener("click", onClick, true);
      window?.addEventListener("blur", clearClickGuard, { once: true });
      clickGuardCleanup.current = () => {
        clickTarget.removeEventListener("click", onClick, true);
        window?.removeEventListener("blur", clearClickGuard);
        if (fallback !== null) window?.clearTimeout(fallback);
      };
      // A completed pointer sequence normally dispatches click before the next
      // task. Expire the guard if the browser synthesizes no click.
      fallback = window?.setTimeout(clearClickGuard, 0) ?? null;
    },
    [clearClickGuard],
  );

  useEffect(() => () => clearClickGuard(), [clearClickGuard]);

  useEffect(() => {
    markArmed(dom.document, interactionActive);

    const surfaceOptions = {
      includeTargetFrames: interactionActive,
      lockSelectionGestures: interactionActive,
    };
    const detachSurfaces = dom.observeInteractionSurfaces(surfaceOptions, (surface) => {
      const targetForEvent = (event: Event) =>
        surface.frame ? dom.targetFromElement(surface.frame) : dom.targetFromEvent(event);

      const setCursor = createSelectionCursor();
      let cursorElement: Element | null = null;
      const clearCursor = () => {
        cursorElement = null;
        setCursor(null);
      };
      const onPointerOut = (event: PointerEvent) => {
        if (!event.relatedTarget) clearCursor();
      };
      const stopCursorLayout = interactionActive
        ? dom.subscribeLayout(() => {
            if (!cursorElement) return;
            const target = dom.targetFromElement(surface.frame ?? cursorElement);
            setCursor(target ? cursorElement : null);
          })
        : () => {};
      const onPointerDown = (event: PointerEvent) => {
        // A new press starts a new gesture. Clear a canceled drag's pointer ID
        // so it cannot swallow this press's release.
        canceledPointerIds.current.delete(event.pointerId);
        const workflow = uiRef.current.workflow;
        if (workflow.mode !== "armed" || event.button !== 0) return;
        const target = targetForEvent(event);
        if (!target) return;
        cursorElement = target.element;
        setCursor(cursorElement);
        const point = parentViewportPoint(event, surface.frame);
        event.preventDefault();
        event.stopPropagation();
        try {
          // Touch pointers already capture their hit element implicitly. Keep that
          // capture instead of transferring it to an ancestor target on mobile.
          if (event.pointerType !== "touch") target.element.setPointerCapture(event.pointerId);
        } catch {
          // Cross-document pointers remain tracked by listeners on both documents.
        }
        dispatch({ type: "startDrag", target, pointerId: event.pointerId, point });
      };

      const onPointerMove = (event: PointerEvent) => {
        const workflow = uiRef.current.workflow;
        if (workflow.mode === "armed") {
          const target = targetForEvent(event);
          const window = surface.document.defaultView;
          cursorElement =
            window && event.pointerType !== "touch"
              ? (event
                  .composedPath()
                  .find((item): item is Element => item instanceof window.Element) ?? null)
              : null;
          setCursor(target ? cursorElement : null);
          dispatch({ type: "focusTarget", target });
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
          // The canceled press would still click what lies under the pointer.
          guardNextClick(surface.document);
          return;
        }
        const workflow = uiRef.current.workflow;
        if (workflow.mode !== "dragging" || workflow.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const end = parentViewportPoint(event, surface.frame);
        const anchor = gestureAnchor(workflow.target.element, workflow.start, end);
        const detailPoint = anchorCenter(workflow.target.element, anchor);
        const frame = surface.frame ?? dom.iframeAtPoint(detailPoint, workflow.target);
        const candidate = frame ?? dom.deepestElementAtPoint(detailPoint.x, detailPoint.y);
        const detail =
          candidate && dom.targetFromElement(candidate)?.key === workflow.target.key
            ? candidate
            : surface.frame
              ? surface.frame
              : deepestElementFromEvent(event, workflow.target.element);
        // This hook-owned listener survives the state update in beginSelection(),
        // which deactivates and tears down the active-interaction effect before
        // the browser dispatches the trailing click.
        guardNextClick(surface.document);
        beginSelection(workflow.target.target, workflow.target.element, anchor, detail);
        if (workflow.target.element.hasPointerCapture(event.pointerId)) {
          workflow.target.element.releasePointerCapture(event.pointerId);
        }
      };

      const onPointerCancel = (event: PointerEvent) => {
        canceledPointerIds.current.delete(event.pointerId);
        const workflow = uiRef.current.workflow;
        if (workflow.mode !== "dragging" || workflow.pointerId !== event.pointerId) return;
        dispatch({ type: "arm" });
      };

      // Escape ends the innermost Lens interaction and returns focus to where
      // it began. A canceled adjustment keeps focus on its marker or handle.
      const escape = (workflow: WorkflowState): boolean => {
        if (cancelAdjustment()) return true;
        if (workflow.mode === "editingNote") {
          dispatch({ type: "closeNote" });
          focusSelectionOrDock(dom, workflow.selectionId);
        } else if (uiRef.current.sheetOpen) {
          dispatch({ type: "setSheetOpen", open: false });
          focusListTrigger(dom);
        } else if (workflow.mode === "armed" || workflow.mode === "dragging") {
          if (workflow.mode === "dragging") {
            const { pointerId, target } = workflow;
            canceledPointerIds.current.add(pointerId);
            if (target.element.hasPointerCapture(pointerId)) {
              target.element.releasePointerCapture(pointerId);
            }
          }
          dispatch({ type: "disarm" });
          focusDock(dom);
        } else {
          return false;
        }
        return true;
      };

      const onKeyDown = (event: KeyboardEvent) => {
        const workflow = uiRef.current.workflow;
        const target = eventTargetElement(event, surface.document);
        // A focused image preview handles Escape before its containing requests sheet.
        if (
          event.key === "Escape" &&
          target?.closest(
            '[data-marimo-lens-snapshot-preview], [aria-haspopup="dialog"][aria-expanded="true"]',
          )
        ) {
          return;
        }
        // The note editor is non-modal, so notebook controls keep their own Escape.
        if (
          event.key === "Escape" &&
          workflow.mode === "editingNote" &&
          target &&
          target !== surface.document.body &&
          !target.closest("[data-marimo-lens-ui]")
        ) {
          return;
        }
        if (event.key === "Escape" && escape(workflow)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.defaultPrevented || workflow.mode !== "armed") return;
        if (event.key === "Tab") {
          dispatch({ type: "disarm" });
          return;
        }
        const lensUi = target?.closest("[data-marimo-lens-ui]");
        if (lensUi && !target?.closest("[data-ml-select]")) return;
        navigateTargets(dom, event, workflow, beginSelection, dispatch);
      };

      surface.document.addEventListener("pointerout", onPointerOut, true);
      surface.document.defaultView?.addEventListener("blur", clearCursor);
      surface.document.addEventListener("pointerdown", onPointerDown, true);
      surface.document.addEventListener("pointermove", onPointerMove, true);
      surface.document.addEventListener("pointerup", onPointerUp, true);
      surface.document.addEventListener("pointercancel", onPointerCancel, true);
      surface.document.addEventListener("keydown", onKeyDown, true);
      return () => {
        clearCursor();
        stopCursorLayout();
        surface.document.removeEventListener("pointerout", onPointerOut, true);
        surface.document.defaultView?.removeEventListener("blur", clearCursor);
        surface.document.removeEventListener("pointerdown", onPointerDown, true);
        surface.document.removeEventListener("pointermove", onPointerMove, true);
        surface.document.removeEventListener("pointerup", onPointerUp, true);
        surface.document.removeEventListener("pointercancel", onPointerCancel, true);
        surface.document.removeEventListener("keydown", onKeyDown, true);
      };
    });

    return () => {
      detachSurfaces();
      if (interactionActive) markArmed(dom.document, false);
    };
  }, [beginSelection, cancelAdjustment, dispatch, dom, guardNextClick, interactionActive, uiRef]);
}

function navigateTargets(
  dom: NotebookDomAdapter,
  event: KeyboardEvent,
  workflow: Extract<WorkflowState, { mode: "armed" }>,
  beginSelection: BeginSelection,
  dispatch: Dispatch<UiAction>,
): void {
  const targets = dom.listTargets();
  if (targets.length === 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const current = targets.findIndex(
      (target) => target.element === workflow.activeTarget?.element,
    );
    const backwards = event.key === "ArrowUp";
    const next =
      current < 0
        ? backwards
          ? targets.length - 1
          : 0
        : (current + (backwards ? -1 : 1) + targets.length) % targets.length;
    const target = targets[next];
    if (!target) return;
    target.element.scrollIntoView({ block: "nearest" });
    dispatch({ type: "focusTarget", target });
    dispatch({
      type: "announce",
      message: targetAnnouncement(target, next, targets.length),
    });
  } else if (event.key === "Enter") {
    event.preventDefault();
    const target =
      targets.find((candidate) => candidate.element === workflow.activeTarget?.element) ??
      targets[0];
    if (!target) return;
    const rect = target.element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const detail =
      dom.iframeAtPoint(point, target) ??
      dom.deepestElementAtPoint(point.x, point.y) ??
      target.element;
    beginSelection(
      target.target,
      target.element,
      {
        kind: "point",
        ...viewportToContent(target.element, point.x, point.y),
      },
      detail,
      "instant",
    );
  }
}

function targetAnnouncement(target: TargetSurface, index: number, count: number): string {
  const info = targetInfo(target);
  return `Target ${index + 1} of ${count}, ${info.label}${info.detail ? `, ${info.detail}` : ""}.`;
}

function eventTargetElement(event: Event, ownerDocument: Document): Element | null {
  const ownerWindow = ownerDocument.defaultView;
  return ownerWindow
    ? (event.composedPath().find((item): item is Element => item instanceof ownerWindow.Element) ??
        null)
    : null;
}

// The armed attribute lets the surface styles turn off pointer events on
// notebook iframes while a selection gesture is in progress.
function markArmed(document: Document, armed: boolean): void {
  if (armed) document.documentElement.dataset.marimoLensArmed = "true";
  else delete document.documentElement.dataset.marimoLensArmed;
}
