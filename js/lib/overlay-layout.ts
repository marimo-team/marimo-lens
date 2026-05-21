import type { CSSProperties } from "react";

import type { LensColumn, LensTarget, PopupState } from "@/types";

import { clamp } from "@/lib/dom-geometry";
import { shapeText } from "@/lib/target-labels";

const POPUP_WIDTH = 326;
const POPUP_ESTIMATED_HEIGHT = 184;
const VIEWPORT_GUTTER = 16;
const MARIMO_TOP_SAFE_AREA = 72;
const MARIMO_BOTTOM_SAFE_AREA = 104;

export function popupStyle(popup: PopupState): CSSProperties {
  const rect = popup.hover.rect;
  const popupWidth = Math.min(POPUP_WIDTH, Math.max(240, window.innerWidth - VIEWPORT_GUTTER * 2));
  const availableTop = Math.min(MARIMO_TOP_SAFE_AREA, window.innerHeight - VIEWPORT_GUTTER);
  const availableBottom = Math.max(
    availableTop + POPUP_ESTIMATED_HEIGHT,
    window.innerHeight - MARIMO_BOTTOM_SAFE_AREA,
  );
  const anchorX = Number.isFinite(popup.x) ? popup.x : rect.left + rect.width / 2;
  const minLeft = VIEWPORT_GUTTER + popupWidth / 2;
  const maxLeft = Math.max(minLeft, window.innerWidth - VIEWPORT_GUTTER - popupWidth / 2);
  const left = clamp(anchorX, minLeft, maxLeft);
  const below = rect.bottom + 12;
  const above = rect.top - POPUP_ESTIMATED_HEIGHT - 12;
  const centered = rect.top + rect.height / 2 - POPUP_ESTIMATED_HEIGHT / 2;
  const top = popupTopPosition({ above, availableBottom, availableTop, below, centered });
  return { left, top, width: popupWidth };
}

function popupTopPosition({
  above,
  availableBottom,
  availableTop,
  below,
  centered,
}: {
  above: number;
  availableBottom: number;
  availableTop: number;
  below: number;
  centered: number;
}): number {
  if (below + POPUP_ESTIMATED_HEIGHT <= availableBottom) return below;
  if (above >= availableTop) return above;
  return clamp(centered, availableTop, availableBottom - POPUP_ESTIMATED_HEIGHT);
}

export function targetBadge(target: LensTarget, column?: LensColumn): string {
  const base = `${target.kind} ${target.variable || target.label}`;
  return column ? `${base} / ${column.name}` : base;
}

export function formatShape(target: LensTarget): string {
  return shapeText(target, { compact: true });
}
