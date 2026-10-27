import type { MouseEvent, PointerEvent } from "react";

import { useLayoutEffect, useRef } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom-context";

export type AdjustmentCancel = () => void;

/** The one adjustment in progress, which Escape cancels. */
export type AdjustmentSlot = {
  registerAdjustment: (cancel: AdjustmentCancel) => void;
  releaseAdjustment: (cancel: AdjustmentCancel) => void;
};

type Offset = { x: number; y: number };

type Press = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  cancel: AdjustmentCancel;
};

/**
 * Follow a primary-button press on a marker or handle. Once the press moves
 * `threshold` pixels it drags, previewing each offset, and its release reports
 * the final offset, or null for a press that never moved. Escape, pointer
 * cancel, and unmount cancel the press and clear the preview.
 */
export function usePointerAdjustment({
  threshold,
  disabled = false,
  registerAdjustment,
  releaseAdjustment,
  preview,
  onDragStart,
  onRelease,
}: AdjustmentSlot & {
  threshold: number;
  disabled?: boolean;
  preview: (offset: Offset | null) => void;
  onDragStart?: () => void;
  onRelease: (offset: Offset | null) => void;
}) {
  const dom = useNotebookDom();
  const press = useRef<Press | null>(null);
  const ended = useRef(false);

  // Pointer capture ends with the control, so a press whose control unmounts
  // can never finish and must clear its preview and release the slot.
  useLayoutEffect(() => () => press.current?.cancel(), []);

  const end = () => {
    const current = press.current;
    if (current) releaseAdjustment(current.cancel);
    press.current = null;
    preview(null);
    // A press that ends, committed or canceled, must not also click the control.
    ended.current = true;
    dom.window.setTimeout(() => {
      ended.current = false;
    }, 0);
  };
  const offset = (event: PointerEvent, start: Press) => ({
    x: event.clientX - start.startX,
    y: event.clientY - start.startY,
  });
  const releaseCapture = (target: Element, pointerId: number) => {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };

  /** Whether `event` is the click that follows a pointer press that already ended. */
  const endsPress = (event: MouseEvent) => {
    if (event.detail === 0 || !ended.current) return false;
    ended.current = false;
    return true;
  };
  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0 || press.current) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const cancel = () => {
        const current = press.current;
        if (!current || current.cancel !== cancel) return;
        releaseCapture(target, current.pointerId);
        end();
      };
      press.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        cancel,
      };
      registerAdjustment(cancel);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const moved = offset(event, current);
      if (!current.moved && Math.hypot(moved.x, moved.y) >= threshold) {
        current.moved = true;
        onDragStart?.();
      }
      if (current.moved) preview(moved);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      releaseCapture(event.currentTarget, event.pointerId);
      end();
      onRelease(current.moved ? offset(event, current) : null);
    },
    onPointerCancel: end,
  };
  return { endsPress, handlers };
}
