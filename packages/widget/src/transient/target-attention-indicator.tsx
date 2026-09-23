import * as stylex from "@stylexjs/stylex";
import { LocateFixed, MousePointer2 } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { intersectBounds, type ViewportBounds } from "@/notebook/viewport";
import { ui } from "@/styles/primitives";
import {
  TARGET_ATTENTION_TOP_GUTTER,
  type TargetAttentionPresentation,
} from "@/transient/target-attention";

import { transientStyles } from "./transient.styles";

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
            reason:
              !target?.isConnected || !presentation.bounds
                ? "target-unavailable"
                : hasVisibleExtent(presentation.bounds, presentation.viewport)
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
  const rect = presentation?.bounds;
  if (!presentation || !target?.isConnected || !rect) return null;
  const { viewport } = presentation;
  const transitioning = presentation.trail && presentation.framing === "pending";
  if (!transitioning && !hasVisibleExtent(rect, viewport)) return null;

  const labelRight = clamp(
    rect.right - 8,
    viewport.left + VIEWPORT_MARGIN,
    viewport.right - VIEWPORT_MARGIN,
  );
  const availableLabelWidth = Math.max(0, labelRight - viewport.left - VIEWPORT_MARGIN);
  const labelMaxWidth = Math.floor(Math.min(LABEL_MAX_WIDTH, availableLabelWidth));
  const labelHeight =
    measurement?.maxWidth === labelMaxWidth ? measurement.height : LABEL_MIN_HEIGHT;
  const minimumTop =
    viewport.top + Math.max(TARGET_ATTENTION_TOP_GUTTER, labelHeight + LABEL_GAP + VIEWPORT_MARGIN);
  const labelTop = transitioning
    ? clamp(rect.top, minimumTop, viewport.bottom - VIEWPORT_MARGIN)
    : rect.top;
  if (labelTop < minimumTop) {
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
      right: ownerWindow.innerWidth - labelRight,
      bottom: ownerWindow.innerHeight - labelTop + LABEL_GAP,
      maxWidth: labelMaxWidth,
    },
  };
}

export function TargetAttentionIndicator({
  view,
  onLabelMeasure,
  controls,
}: {
  view: TargetAttentionView | null;
  onLabelMeasure?: (sequence: number, measurement: TargetAttentionLabelMeasurement) => void;
  controls?: ReactNode;
}) {
  const labelRef = useRef<HTMLDivElement>(null);
  const sequence = view?.presentation.sequence;
  const maxWidth = view?.labelMaxWidth;
  const hasControls = !!controls;
  useLayoutEffect(() => {
    if (sequence === undefined || maxWidth === undefined || !onLabelMeasure || !labelRef.current)
      return;
    const height = Math.ceil(labelRef.current.getBoundingClientRect().height);
    if (height > 0) {
      onLabelMeasure(sequence, {
        height,
        maxWidth,
      });
    }
  }, [onLabelMeasure, sequence, maxWidth, hasControls]);

  if (!view) return null;
  const { presentation } = view;
  const { message } = presentation;
  const targetLabel = presentation.locator.label;
  const status = presentation.label ?? (presentation.kind === "activity" ? "Working" : "Ready");
  const detail = message;

  return (
    <div
      {...stylex.props(
        transientStyles.attention,
        presentation.kind === "activity" && transientStyles.activity,
        presentation.phase === "exiting" && transientStyles.exiting,
      )}
      data-marimo-lens-target-attention
      data-kind={presentation.kind}
      data-phase={presentation.phase}
      data-target-kind={presentation.locator.kind}
      data-target-label={targetLabel}
      data-marimo-lens-ui
      aria-hidden={controls ? undefined : true}
    >
      <div {...stylex.props(transientStyles.ring)} style={view.ring} />
      <div
        ref={labelRef}
        {...stylex.props(transientStyles.attentionLabel)}
        data-marimo-lens-target-attention-label
        style={view.label}
      >
        {presentation.kind === "activity" ? (
          <WorkingIndicator />
        ) : (
          <MousePointer2
            {...stylex.props(transientStyles.notificationIcon)}
            size={14}
            strokeWidth={2}
            aria-hidden="true"
          />
        )}
        <span {...stylex.props(transientStyles.attentionStatus)} data-marimo-lens-attention-status>
          {status}
        </span>
        {!presentation.trail && (
          <span {...stylex.props(transientStyles.target)}>{targetLabel}</span>
        )}
        {detail ? (
          <span
            key={presentation.sequence}
            {...stylex.props(transientStyles.attentionMessage)}
            data-marimo-lens-attention-message
          >
            {detail}
          </span>
        ) : null}
        {controls}
      </div>
    </div>
  );
}

export function TargetAttentionFallback({
  presentation,
  reason,
  controls,
}: TargetAttentionFallbackView & { controls?: ReactNode }) {
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
      {...stylex.props(
        transientStyles.notification,
        transientStyles.notice,
        presentation.kind === "activity" && transientStyles.activity,
        presentation.kind === "reveal" && transientStyles.revealNotice,
        presentation.phase === "exiting" && transientStyles.exiting,
        presentation.phase === "exiting" && transientStyles.exitingNotice,
      )}
      data-marimo-lens-target-attention-notice
      data-kind={presentation.kind}
      data-phase={presentation.phase}
      data-target-kind={presentation.locator.kind}
      data-target-label={targetLabel}
      data-marimo-lens-ui
      aria-hidden={controls ? undefined : true}
    >
      <LocateFixed
        {...stylex.props(transientStyles.notificationIcon)}
        size={14}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span {...stylex.props(transientStyles.noticeStatus)} data-marimo-lens-attention-status>
        {status}
      </span>
      {!presentation.trail && <span {...stylex.props(transientStyles.target)}>{targetLabel}</span>}
      {message ? <span {...stylex.props(transientStyles.noticeMessage)}>{message}</span> : null}
      {controls}
    </div>
  );
}

function WorkingIndicator() {
  return (
    <svg
      {...stylex.props(transientStyles.working, transientStyles.notificationIcon)}
      data-marimo-lens-working-indicator
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      {WORKING_DOTS.map(({ index, row, column }) => (
        <circle
          {...stylex.props(
            transientStyles.workingDot,
            index === 4 && transientStyles.workingDotCenter,
          )}
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
      {...stylex.props(ui.visuallyHidden)}
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
  const step =
    presentation.trail && presentation.trail.count > 1
      ? `Step ${presentation.trail.index + 1} of ${presentation.trail.count}. `
      : "";
  return step + (message ? `${status} ${message}` : status);
}

function hasVisibleExtent(rect: DOMRectReadOnly, viewport: ViewportBounds): boolean {
  const visible = intersectBounds(rect, viewport);
  return !!visible && visible.width >= MIN_VISIBLE_TARGET && visible.height >= MIN_VISIBLE_TARGET;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
