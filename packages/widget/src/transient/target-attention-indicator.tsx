import { LocateFixed, MousePointer2 } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import {
  TARGET_ATTENTION_TOP_GUTTER,
  type TargetAttentionPresentation,
} from "@/transient/target-attention";

const VIEWPORT_MARGIN = 12;
const LABEL_MIN_HEIGHT = 28;
const LABEL_GAP = 8;
const LABEL_MAX_WIDTH = 480;
const MIN_VISIBLE_TARGET = 12;
const WORKING_DOTS = Array.from({ length: 9 }, (_, index) => ({
  index,
  row: Math.floor(index / 3),
  column: index % 3,
}));

export type TargetAttentionView = {
  presentation: TargetAttentionPresentation;
  ring: CSSProperties;
  label: CSSProperties;
  labelMaxWidth: number;
};

export type TargetAttentionLabelMeasurement = {
  height: number;
  maxWidth: number;
};

export type TargetAttentionSurface = {
  view: TargetAttentionView | null;
  fallback: TargetAttentionFallbackView | null;
};

export type TargetAttentionFallbackView = {
  presentation: TargetAttentionPresentation;
  reason: "target-unavailable" | "offscreen" | "label-space";
};

export function projectTargetAttentionSurface(
  presentation: TargetAttentionPresentation | null,
  ownerWindow: Window,
  measurement?: TargetAttentionLabelMeasurement,
): TargetAttentionSurface {
  const view = projectTargetAttention(presentation, ownerWindow, measurement);
  if (view !== null || presentation === null) {
    return { view, fallback: null };
  }
  const target = presentation.target;
  return {
    view: null,
    fallback:
      presentation.framing === "pending"
        ? null
        : {
            presentation,
            reason: !target?.isConnected
              ? "target-unavailable"
              : intersectsViewport(target.getBoundingClientRect(), ownerWindow)
                ? "label-space"
                : "offscreen",
          },
  };
}

export function projectTargetAttention(
  presentation: TargetAttentionPresentation | null,
  ownerWindow: Window,
  measurement?: TargetAttentionLabelMeasurement,
): TargetAttentionView | null {
  const target = presentation?.target;
  if (!presentation || !target?.isConnected) return null;
  const rect = target.getBoundingClientRect();
  if (!intersectsViewport(rect, ownerWindow)) return null;

  const anchor = clamp(
    ownerWindow.innerWidth - rect.right + 8,
    VIEWPORT_MARGIN,
    ownerWindow.innerWidth - VIEWPORT_MARGIN,
  );
  const availableLabelWidth = Math.max(0, ownerWindow.innerWidth - anchor - VIEWPORT_MARGIN);
  const labelMaxWidth = Math.floor(Math.min(LABEL_MAX_WIDTH, availableLabelWidth));
  const labelHeight =
    measurement?.maxWidth === labelMaxWidth ? measurement.height : LABEL_MIN_HEIGHT;
  if (rect.top < Math.max(TARGET_ATTENTION_TOP_GUTTER, labelHeight + LABEL_GAP + VIEWPORT_MARGIN)) {
    return null;
  }

  return {
    presentation,
    labelMaxWidth,
    ring: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    label: {
      right: anchor,
      bottom: ownerWindow.innerHeight - rect.top + LABEL_GAP,
      maxWidth: labelMaxWidth,
    },
  };
}

export function TargetAttentionIndicator({
  view,
  onLabelMeasure,
}: {
  view: TargetAttentionView | null;
  onLabelMeasure?: (sequence: number, measurement: TargetAttentionLabelMeasurement) => void;
}) {
  const labelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!view || !onLabelMeasure || !labelRef.current) return;
    const height = Math.ceil(labelRef.current.getBoundingClientRect().height);
    if (height > 0) {
      onLabelMeasure(view.presentation.sequence, {
        height,
        maxWidth: view.labelMaxWidth,
      });
    }
  }, [onLabelMeasure, view]);

  if (!view) return null;
  const { presentation } = view;
  const { message } = presentation;
  const targetLabel = presentation.locator.label;
  const status = presentation.label ?? (presentation.kind === "activity" ? "Working" : "Ready");
  const detail = message;

  return (
    <div
      className="ml-target-attention"
      data-marimo-lens-target-attention
      data-kind={presentation.kind}
      data-phase={presentation.phase}
      data-target-kind={presentation.locator.kind}
      data-target-label={targetLabel}
      data-marimo-lens-ui
      aria-hidden="true"
    >
      <div className="ml-target-attention__ring" style={view.ring} />
      <div ref={labelRef} className="ml-target-attention__label" style={view.label}>
        {presentation.kind === "activity" ? (
          <WorkingIndicator />
        ) : (
          <MousePointer2 size={14} strokeWidth={2} aria-hidden="true" />
        )}
        <span className="ml-target-attention__status">{status}</span>
        <span className="ml-target-attention__target">{targetLabel}</span>
        {detail ? <span className="ml-target-attention__message">{detail}</span> : null}
      </div>
    </div>
  );
}

export function TargetAttentionFallback({ presentation, reason }: TargetAttentionFallbackView) {
  const { message } = presentation;
  const targetLabel = presentation.locator.label;
  const status =
    presentation.label ??
    (presentation.kind === "activity"
      ? "Working"
      : reason === "label-space"
        ? "Ready"
        : "Not visible");
  return (
    <div
      className="ml-target-attention-notice"
      data-marimo-lens-target-attention-notice
      data-kind={presentation.kind}
      data-phase={presentation.phase}
      data-target-kind={presentation.locator.kind}
      data-target-label={targetLabel}
      data-marimo-lens-ui
      aria-hidden="true"
    >
      <LocateFixed size={14} strokeWidth={2} aria-hidden="true" />
      <span className="ml-target-attention-notice__status">{status}</span>
      <span className="ml-target-attention-notice__target">{targetLabel}</span>
      {message ? <span className="ml-target-attention-notice__message">{message}</span> : null}
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

export function TargetAttentionAnnouncement({
  presentation,
}: {
  presentation: TargetAttentionPresentation | null;
}) {
  return (
    <output
      className="ml-sr-status"
      data-marimo-lens-target-attention-status
      aria-live="polite"
      aria-atomic="true"
    >
      {presentation ? (
        <span key={presentation.sequence}>{attentionAnnouncement(presentation)}</span>
      ) : null}
    </output>
  );
}

function attentionAnnouncement(presentation: TargetAttentionPresentation): string {
  const { label, message } = presentation;
  const target = `${presentation.locator.kind} ${presentation.locator.label}`;
  const preposition = presentation.locator.kind === "cell" ? "in" : "on";
  const status =
    presentation.kind === "activity"
      ? `${label ?? "Working"} ${preposition} ${target}.`
      : label
        ? `${label} ${preposition} ${target}.`
        : `Revealed ${target}.`;
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
