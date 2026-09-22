import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState } from "react";

import type { TargetSurface } from "@/notebook/selection-target";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { targetInfo } from "@/notebook/target-info";
import { intersectBounds } from "@/notebook/viewport";

import { targetInfoStyles } from "./target-info.styles";

export function TargetInfoLabel({ target, bounds }: { target: TargetSurface; bounds: DOMRect }) {
  const dom = useNotebookDom();
  const info = targetInfo(target);
  const label = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const viewport = dom.viewportBounds();
  const visible =
    target.element.isConnected &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    intersectBounds(bounds, viewport) !== null;
  useLayoutEffect(() => {
    if (!visible || !label.current) return;
    const place = () => {
      if (!label.current) return;
      const rect = label.current.getBoundingClientRect();
      const left = Math.max(
        viewport.left + 8,
        Math.min(bounds.left, viewport.right - rect.width - 8),
      );
      const above = bounds.top - rect.height - 6;
      const top = Math.max(
        viewport.top + 8,
        Math.min(
          above >= viewport.top + 8 ? above : bounds.top + 6,
          viewport.bottom - rect.height - 8,
        ),
      );
      setPosition((previous) =>
        previous.left === left && previous.top === top ? previous : { left, top },
      );
    };
    place();
    const observer = dom.window.ResizeObserver ? new dom.window.ResizeObserver(place) : null;
    observer?.observe(label.current);
    return () => observer?.disconnect();
  }, [
    bounds.left,
    bounds.top,
    dom,
    info.label,
    info.detail,
    viewport.left,
    viewport.top,
    viewport.right,
    viewport.bottom,
    visible,
  ]);

  if (!visible) return null;

  return (
    <div
      ref={label}
      {...stylex.props(targetInfoStyles.label)}
      data-marimo-lens-target-label
      aria-hidden="true"
      style={{ ...position, maxWidth: Math.max(0, viewport.width - 16) }}
    >
      <span {...stylex.props(targetInfoStyles.name)}>{info.label}</span>
      {info.detail && <span {...stylex.props(targetInfoStyles.detail)}>{info.detail}</span>}
    </div>
  );
}
