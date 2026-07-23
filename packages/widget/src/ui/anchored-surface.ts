import { useLayoutEffect, useReducer, type CSSProperties } from "react";

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
  fallback = { style: {}, placement: preferredPlacement },
}: AnchoredSurfaceOptions): AnchoredSurfacePosition {
  const dom = useNotebookDom();
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const ownerWindow = anchor?.element.ownerDocument.defaultView ?? dom.window;
  const hasAnchor = anchor !== null;

  useLayoutEffect(() => {
    if (!open) return undefined;
    if (!hasAnchor) refresh();
    return dom.subscribeLayout(refresh);
  }, [dom, hasAnchor, open]);

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

  if (preferredPlacement === "below") {
    const top = anchor.rect.bottom + gap;
    return {
      style: {
        left,
        top: surfaceHeight
          ? clamp(top, edgePadding, Math.max(edgePadding, viewportHeight - surfaceHeight))
          : top,
        width,
      },
      placement: "below",
    };
  }

  const bottom = viewportHeight - anchor.rect.top + gap;
  return {
    style: {
      left,
      bottom: surfaceHeight ? Math.max(edgePadding, bottom) : bottom,
      width,
    },
    placement: "above",
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
