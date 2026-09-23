import { useLayoutEffect, useReducer, useState, type CSSProperties, type RefObject } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";

type AnchoredSurfacePlacement = "above" | "below";

export type AnchoredSurfaceAnchor = {
  element: Element;
  rect: Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom" | "width" | "height">;
};

export type AnchoredSurfacePosition = {
  style: CSSProperties;
  placement: AnchoredSurfacePlacement;
};

type AnchoredSurfaceFallback = {
  /** Offsets from the notebook pane edges. */
  inset: Partial<Record<"left" | "top" | "right" | "bottom", number>>;
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
  fallback?: AnchoredSurfaceFallback;
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
  fallback = { inset: {}, placement: preferredPlacement },
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

  const viewport = dom.viewportBounds();
  if (!anchor) {
    const { inset, placement } = fallback;
    return {
      style: {
        left: offset(viewport.left, inset.left),
        top: offset(viewport.top, inset.top),
        right: offset(ownerWindow.innerWidth - viewport.right, inset.right),
        bottom: offset(ownerWindow.innerHeight - viewport.bottom, inset.bottom),
      },
      placement,
    };
  }

  const width = Math.min(requestedWidth, Math.max(0, viewport.width - edgePadding * 2));
  const alignedLeft =
    (align === "center" ? anchor.rect.left + anchor.rect.width / 2 - width / 2 : anchor.rect.left) +
    horizontalOffset;
  const left = clamp(
    alignedLeft,
    viewport.left + edgePadding,
    Math.max(viewport.left + edgePadding, viewport.right - width - edgePadding),
  );

  const height = measuredHeight || surfaceHeight;
  const spaceAbove = anchor.rect.top - viewport.top - gap - edgePadding;
  const spaceBelow = viewport.bottom - anchor.rect.bottom - gap - edgePadding;
  let placement = preferredPlacement;
  if (height) {
    if (placement === "above" && height > spaceAbove && spaceBelow > spaceAbove) {
      placement = "below";
    } else if (placement === "below" && height > spaceBelow && spaceAbove > spaceBelow) {
      placement = "above";
    }
  }
  const minimumTop = viewport.top + edgePadding;
  const maximumTop = Math.max(minimumTop, viewport.bottom - (height ?? 0) - edgePadding);

  if (placement === "below") {
    return {
      style: {
        left,
        top: clamp(anchor.rect.bottom + gap, minimumTop, maximumTop),
        width,
      },
      placement,
    };
  }

  const edge = anchor.rect.top - gap;
  return {
    style: {
      left,
      bottom:
        ownerWindow.innerHeight -
        (height ? clamp(edge, minimumTop + height, viewport.bottom - edgePadding) : edge),
      width,
    },
    placement,
  };
}

function offset(edge: number, inset: number | undefined): number | undefined {
  return inset === undefined ? undefined : edge + inset;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
