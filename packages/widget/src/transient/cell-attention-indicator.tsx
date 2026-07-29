import type { CSSProperties } from "react";

import { LocateFixed, MousePointer2 } from "lucide-react";

import type { CellAttentionPresentation } from "@/transient/cell-attention";

const VIEWPORT_MARGIN = 12;
const LABEL_MIN_HEIGHT = 28;
const LABEL_ESTIMATED_HEIGHT = 152;
const LONG_REVEAL_ESTIMATED_HEIGHT = 320;
const LABEL_GAP = 8;
const LABEL_MAX_WIDTH = 480;
const COMPACT_MESSAGE_LENGTH = 240;
const MIN_VISIBLE_TARGET = 12;
const WORKING_DOTS = Array.from({ length: 9 }, (_, index) => ({
  index,
  row: Math.floor(index / 3),
  column: index % 3,
}));

export type CellAttentionView = {
  presentation: CellAttentionPresentation;
  ring: CSSProperties;
  label: CSSProperties;
};

export function projectCellAttention(
  presentation: CellAttentionPresentation | null,
  ownerWindow: Window,
): CellAttentionView | null {
  const target = presentation?.target;
  if (!presentation || !target?.isConnected) return null;
  const rect = target.getBoundingClientRect();
  if (!intersectsViewport(rect, ownerWindow)) return null;

  const targetOnRight = rect.left + rect.width / 2 > ownerWindow.innerWidth / 2;
  const anchor = targetOnRight
    ? clamp(
        ownerWindow.innerWidth - rect.right + 8,
        VIEWPORT_MARGIN,
        ownerWindow.innerWidth - VIEWPORT_MARGIN,
      )
    : clamp(rect.left + 8, VIEWPORT_MARGIN, ownerWindow.innerWidth - VIEWPORT_MARGIN);
  const availableLabelWidth = Math.max(0, ownerWindow.innerWidth - anchor - VIEWPORT_MARGIN);
  const labelHorizontal = targetOnRight
    ? { right: anchor, maxWidth: Math.min(LABEL_MAX_WIDTH, availableLabelWidth) }
    : { left: anchor, maxWidth: Math.min(LABEL_MAX_WIDTH, availableLabelWidth) };
  const estimatedLabelHeight =
    presentation.kind === "reveal" &&
    (presentation.event.payload.message?.length ?? 0) > COMPACT_MESSAGE_LENGTH
      ? LONG_REVEAL_ESTIMATED_HEIGHT
      : LABEL_ESTIMATED_HEIGHT;
  const labelVertical =
    rect.top >= estimatedLabelHeight + LABEL_GAP + VIEWPORT_MARGIN
      ? { bottom: ownerWindow.innerHeight - rect.top + LABEL_GAP }
      : {
          top: clamp(
            rect.top + LABEL_GAP,
            VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, ownerWindow.innerHeight - LABEL_MIN_HEIGHT - VIEWPORT_MARGIN),
          ),
        };

  return {
    presentation,
    ring: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    label: { ...labelVertical, ...labelHorizontal },
  };
}

export function CellAttentionIndicator({ view }: { view: CellAttentionView | null }) {
  if (!view) return null;
  const { presentation } = view;
  const { cellId, message } = presentation.event.payload;
  const status =
    presentation.event.type === "cell.activity"
      ? (presentation.event.payload.label ?? "Working")
      : "Ready";
  const detail = message;

  return (
    <div
      className="ml-cell-attention"
      data-marimo-lens-cell-attention
      data-kind={presentation.kind}
      data-phase={presentation.phase}
      data-cell-id={cellId}
      data-marimo-lens-ui
      aria-hidden="true"
    >
      <div className="ml-cell-attention__ring" style={view.ring} />
      <div className="ml-cell-attention__label" style={view.label}>
        {presentation.kind === "activity" ? (
          <WorkingIndicator />
        ) : (
          <MousePointer2 size={14} strokeWidth={2} aria-hidden="true" />
        )}
        <span className="ml-cell-attention__status">{status}</span>
        <span className="ml-cell-attention__cell">{cellId}</span>
        {detail ? <span className="ml-cell-attention__message">{detail}</span> : null}
      </div>
    </div>
  );
}

export function CellAttentionFallback({
  presentation,
}: {
  presentation: CellAttentionPresentation;
}) {
  const { cellId, message } = presentation.event.payload;
  const status =
    presentation.event.type === "cell.activity"
      ? (presentation.event.payload.label ?? "Working")
      : "Not visible";
  return (
    <div
      className="ml-cell-attention-notice"
      data-marimo-lens-cell-attention-notice
      data-kind={presentation.kind}
      data-phase={presentation.phase}
      data-cell-id={cellId}
      data-marimo-lens-ui
      aria-hidden="true"
    >
      <LocateFixed size={14} strokeWidth={2} aria-hidden="true" />
      <span className="ml-cell-attention-notice__status">{status}</span>
      <span className="ml-cell-attention-notice__cell">{cellId}</span>
      {message ? <span className="ml-cell-attention-notice__message">{message}</span> : null}
    </div>
  );
}

function WorkingIndicator() {
  return (
    <svg
      className="ml-working-indicator"
      data-marimo-lens-working-indicator
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      {WORKING_DOTS.map(({ index, row, column }) => (
        <circle
          key={index}
          cx={2 + column * 4}
          cy={2 + row * 4}
          r="1.15"
          style={{ animationDelay: `${-(row + column) * 110}ms` }}
        />
      ))}
    </svg>
  );
}

export function CellAttentionAnnouncement({
  presentation,
}: {
  presentation: CellAttentionPresentation | null;
}) {
  return (
    <output
      className="ml-sr-status"
      data-marimo-lens-cell-attention-status
      aria-live="polite"
      aria-atomic="true"
    >
      {presentation ? (
        <span key={presentation.sequence}>{announceCellAttention(presentation)}</span>
      ) : null}
    </output>
  );
}

function announceCellAttention(presentation: CellAttentionPresentation): string {
  const { cellId, message } = presentation.event.payload;
  const status =
    presentation.event.type === "cell.activity"
      ? `${presentation.event.payload.label ?? "Working"} in cell ${cellId}.`
      : `Revealed cell ${cellId}.`;
  return message ? `${status} ${message}` : status;
}

function intersectsViewport(rect: DOMRect, ownerWindow: Window): boolean {
  const visibleWidth = Math.min(rect.right, ownerWindow.innerWidth) - Math.max(rect.left, 0);
  const visibleHeight = Math.min(rect.bottom, ownerWindow.innerHeight) - Math.max(rect.top, 0);
  return visibleWidth >= MIN_VISIBLE_TARGET && visibleHeight >= MIN_VISIBLE_TARGET;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
