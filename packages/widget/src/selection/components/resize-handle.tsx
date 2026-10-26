import type { RectAnchor, Selection } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";

import { resizeRectAnchor, type ResizeHandle } from "@/selection/anchor";
import { ui } from "@/styles/primitives";

import { usePointerAdjustment, type AdjustmentCancel, type AdjustmentSlot } from "./adjustment";
import { resizeHandleStyles } from "./resize-handle.styles";

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];

const HANDLE_NAMES = {
  nw: "top left",
  ne: "top right",
  sw: "bottom left",
  se: "bottom right",
} satisfies Record<ResizeHandle, string>;

export function ResizeHandleButton({
  selection,
  anchor,
  output,
  handle,
  disabled,
  onPreview,
  onCommit,
  registerAdjustment,
  releaseAdjustment,
}: AdjustmentSlot & {
  selection: Selection;
  anchor: RectAnchor;
  output: HTMLElement;
  handle: ResizeHandle;
  disabled: boolean;
  onPreview: (anchor: RectAnchor | null) => void;
  onCommit: (anchor: RectAnchor) => void;
}) {
  const keyboardPreview = useRef<RectAnchor | null>(null);
  const keyboardCancel = useRef<AdjustmentCancel | null>(null);
  const resized = (offset: { x: number; y: number }) =>
    resizeRectAnchor(output, anchor, handle, offset.x, offset.y);
  const { handlers } = usePointerAdjustment({
    threshold: 1,
    disabled,
    registerAdjustment,
    releaseAdjustment,
    preview: (offset) => onPreview(offset && resized(offset)),
    onRelease: (offset) => {
      if (offset) onCommit(resized(offset));
    },
  });

  // The marker outlives its handles, so an unmounting handle resets the
  // preview it drew there.
  useEffect(() => () => keyboardCancel.current?.(), []);

  const commitKeyboardPreview = () => {
    const next = keyboardPreview.current;
    if (!next) return;
    const cancel = keyboardCancel.current;
    if (cancel) releaseAdjustment(cancel);
    keyboardCancel.current = null;
    keyboardPreview.current = null;
    onPreview(null);
    onCommit(next);
  };

  return (
    <button
      {...stylex.props(ui.interactive, resizeHandleStyles.resizeHandle, resizeHandleStyles[handle])}
      data-marimo-lens-resize-handle
      data-handle={handle}
      type="button"
      aria-disabled={disabled || undefined}
      aria-label={`Resize selection ${selection.label} from ${HANDLE_NAMES[handle]}. Use arrow keys.`}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      {...handlers}
      onKeyDown={(event) => {
        const delta = keyboardDelta(output, event.key, event.shiftKey);
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        if (!keyboardCancel.current) {
          const cancel = () => {
            if (keyboardCancel.current !== cancel) return;
            keyboardCancel.current = null;
            keyboardPreview.current = null;
            onPreview(null);
            releaseAdjustment(cancel);
          };
          keyboardCancel.current = cancel;
          registerAdjustment(cancel);
        }
        const next = resizeRectAnchor(
          output,
          keyboardPreview.current ?? anchor,
          handle,
          delta.x,
          delta.y,
        );
        keyboardPreview.current = next;
        onPreview(next);
      }}
      onKeyUp={(event) => {
        if (!isArrowKey(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        commitKeyboardPreview();
      }}
      onBlur={commitKeyboardPreview}
    />
  );
}

function keyboardDelta(
  output: HTMLElement,
  key: string,
  largeStep: boolean,
): { x: number; y: number } | null {
  if (!isArrowKey(key)) return null;
  const bounds = output.getBoundingClientRect();
  const width = Math.max(output.scrollWidth, bounds.width, 1);
  const height = Math.max(output.scrollHeight, bounds.height, 1);
  const step = largeStep ? 0.05 : 0.01;
  if (key === "ArrowLeft") return { x: -width * step, y: 0 };
  if (key === "ArrowRight") return { x: width * step, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -height * step };
  return { x: 0, y: height * step };
}

function isArrowKey(key: string): boolean {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}
