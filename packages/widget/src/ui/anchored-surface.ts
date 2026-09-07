import { useLayoutEffect, useReducer, useState, type CSSProperties, type RefObject } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";

export type AnchoredSurfacePlacement = "above" | "below";

export type AnchoredSurfaceAnchor = {
  element: Element;
  rect: Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom" | "width" | "height">;
};

export type AnchoredSurfacePosition = {
  style: CSSProperties;
  placement: AnchoredSurfacePlacement;
};

type AnchoredSurfaceOptions = {
  anchor: AnchoredSurfaceAnchor | null;
  open: boolean;
  preferredPlacement: AnchoredSurfacePlacement;
  gap: number;
  width: number;
  align?: "center" | "start";
  horizontalOffset?: number;
  edgePadding?: number;
  surfaceHeight?: number;
  surfaceRef?: RefObject<HTMLElement | null>;
  fallback?: AnchoredSurfacePosition;
};

export function useAnchoredSurface({
  anchor,
  open,
  preferredPlacement,
  gap,
  width: requestedWidth,
  align = "center",
  horizontalOffset = 0,
  edgePadding = 12,
  surfaceHeight,
  surfaceRef,
  fallback = { style: {}, placement: preferredPlacement },
}: AnchoredSurfaceOptions): AnchoredSurfacePosition {
  const dom = useNotebookDom();
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const ownerWindow = anchor?.element.ownerDocument.defaultView ?? dom.window;
  const hasAnchor = anchor !== null;

  useLayoutEffect(() => {
    if (!open) return undefined;
    if (!hasAnchor) refresh();
    return dom.subscribeLayout(refresh);
  }, [dom, hasAnchor, open]);

  useLayoutEffect(() => {
    const surface = surfaceRef?.current;
    if (!open || !surface) return undefined;
    const measure = () => setMeasuredHeight(surface.getBoundingClientRect().height);
    measure();
    const observer = ownerWindow.ResizeObserver ? new ownerWindow.ResizeObserver(measure) : null;
    observer?.observe(surface);
    return () => observer?.disconnect();
  }, [open, ownerWindow, surfaceRef]);

  if (!anchor) return fallback;

  const viewportWidth = ownerWindow.innerWidth;
  const viewportHeight = ownerWindow.innerHeight;
  const width = Math.min(requestedWidth, Math.max(0, viewportWidth - edgePadding * 2));
  const alignedLeft =
    (align === "center" ? anchor.rect.left + anchor.rect.width / 2 - width / 2 : anchor.rect.left) +
    horizontalOffset;
  const left = clamp(
    alignedLeft,
    edgePadding,
    Math.max(edgePadding, viewportWidth - width - edgePadding),
  );

  const height = measuredHeight || surfaceHeight;
  const spaceAbove = anchor.rect.top - gap - edgePadding;
  const spaceBelow = viewportHeight - anchor.rect.bottom - gap - edgePadding;
  let placement = preferredPlacement;
  if (height) {
    if (placement === "above" && height > spaceAbove && spaceBelow > spaceAbove) {
      placement = "below";
    } else if (placement === "below" && height > spaceBelow && spaceAbove > spaceBelow) {
      placement = "above";
    }
  }
  const maximumTop = Math.max(edgePadding, viewportHeight - (height ?? 0) - edgePadding);

  if (placement === "below") {
    return {
      style: {
        left,
        top: clamp(anchor.rect.bottom + gap, edgePadding, maximumTop),
        width,
      },
      placement,
    };
  }

  const bottom = viewportHeight - anchor.rect.top + gap;
  return {
    style: {
      left,
      bottom: height
        ? clamp(bottom, edgePadding, Math.max(edgePadding, viewportHeight - height - edgePadding))
        : bottom,
      width,
    },
    placement,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
