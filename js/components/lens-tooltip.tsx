import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type LensTooltipProps = {
  content: string;
  children: ReactNode;
};

const TOOLTIP_DELAY_MS = 420;
const TOOLTIP_EXIT_MS = 140;
const TOOLTIP_WIDTH = 220;
const VIEWPORT_GAP = 10;

type TooltipPosition = {
  left: number;
  top: number;
  side: "top" | "bottom";
};

export function LensTooltip({ content, children }: LensTooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const [visible, setVisible] = useState(false);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const minCenter = VIEWPORT_GAP + TOOLTIP_WIDTH / 2;
    const maxCenter = Math.max(minCenter, window.innerWidth - VIEWPORT_GAP - TOOLTIP_WIDTH / 2);
    const canShowAbove = rect.top > 48;
    setPosition({
      left: clamp(rect.left + rect.width / 2, minCenter, maxCenter),
      top: canShowAbove ? rect.top - VIEWPORT_GAP : rect.bottom + VIEWPORT_GAP,
      side: canShowAbove ? "top" : "bottom",
    });
  }, []);
  const updatePositionFromViewport = useEffectEvent(updatePosition);

  const show = useCallback(() => {
    clearTimers();
    updatePosition();
    showTimerRef.current = window.setTimeout(() => setVisible(true), TOOLTIP_DELAY_MS);
  }, [clearTimers, updatePosition]);

  const hide = useCallback(() => {
    clearTimers();
    setVisible(false);
    hideTimerRef.current = window.setTimeout(() => setPosition(null), TOOLTIP_EXIT_MS);
  }, [clearTimers]);
  const portalRoot =
    typeof document === "undefined"
      ? null
      : (anchorRef.current?.closest(".marimo_lens") ?? document.body);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!position) return undefined;
    const reposition = () => updatePositionFromViewport();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [position]);

  return (
    <span
      ref={anchorRef}
      className="ml-tooltip-anchor"
      onBlur={hide}
      onFocus={show}
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      {children}
      {position && portalRoot
        ? createPortal(
            <div
              className="ml-tooltip-popover"
              data-marimo-lens-ui
              data-side={position.side}
              data-visible={visible ? "true" : "false"}
              role="tooltip"
              style={{ left: position.left, top: position.top }}
            >
              {content}
            </div>,
            portalRoot,
          )
        : null}
    </span>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
