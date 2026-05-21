import { useEffect, useRef } from "react";

import type { LensTarget, ResolvedHover } from "@/types";

import { eventTargetElement, isLensInterfaceEvent } from "@/selection/dom-events";
import { resolveElementSelection, resolvePointSelection } from "@/selection/selection-registry";
import { useLensUiStore } from "@/store";

export function useLensCapture(targets: LensTarget[]) {
  const armed = useLensUiStore((state) => state.armed);
  const dragging = useLensUiStore((state) => state.dragging);
  const popup = useLensUiStore((state) => state.popup);
  const hover = useLensUiStore((state) => state.hover);
  const setHover = useLensUiStore((state) => state.setHover);
  const setPopup = useLensUiStore((state) => state.setPopup);
  const stopCapture = useLensUiStore((state) => state.stopCapture);
  const hoverRef = useRef<ResolvedHover | null>(null);
  const lastHoverProbeRef = useRef<{
    element: Element | null;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.toggleAttribute("data-marimo-lens-capture", armed);
    return () => {
      document.documentElement.removeAttribute("data-marimo-lens-capture");
    };
  }, [armed]);

  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);

  useEffect(() => {
    if (!armed || popup || dragging) return;
    lastHoverProbeRef.current = null;
    let frame = 0;
    const onPointerMove = (event: PointerEvent) => {
      if (isLensInterfaceEvent(event)) return;
      const element = eventTargetElement(event);
      const lastProbe = lastHoverProbeRef.current;
      if (
        lastProbe?.element === element &&
        Math.abs(lastProbe.x - event.clientX) < 4 &&
        Math.abs(lastProbe.y - event.clientY) < 4
      ) {
        return;
      }
      lastHoverProbeRef.current = { element, x: event.clientX, y: event.clientY };
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const point = { x: event.clientX, y: event.clientY };
        const resolved =
          (element ? resolveElementSelection(element, targets, point) : null) ??
          resolvePointSelection(point, targets);
        setHover(resolved);
      });
    };
    const listenerOptions = { capture: true, passive: true };

    document.addEventListener("pointermove", onPointerMove, listenerOptions);
    document.addEventListener("pointerover", onPointerMove, listenerOptions);
    window.addEventListener("pointermove", onPointerMove, listenerOptions);
    window.addEventListener("pointerover", onPointerMove, listenerOptions);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onPointerMove, listenerOptions);
      document.removeEventListener("pointerover", onPointerMove, listenerOptions);
      window.removeEventListener("pointermove", onPointerMove, listenerOptions);
      window.removeEventListener("pointerover", onPointerMove, listenerOptions);
    };
  }, [armed, dragging, popup, setHover, targets]);

  useEffect(() => {
    if (!armed) return;
    const onClick = (event: MouseEvent) => {
      if (isLensInterfaceEvent(event)) return;
      const element = eventTargetElement(event);
      const point = { x: event.clientX, y: event.clientY };
      const resolved =
        (element ? resolveElementSelection(element, targets, point) : null) ??
        resolvePointSelection(point, targets) ??
        hoverRef.current;
      if (!resolved) return;
      event.preventDefault();
      event.stopPropagation();
      setPopup({ hover: resolved, x: event.clientX, y: event.clientY });
      stopCapture();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [armed, setPopup, stopCapture, targets]);
}
