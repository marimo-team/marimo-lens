import { useEffect, useState, type CSSProperties } from "react";
import { IconX } from "@/components/icons";
import { LensPopup } from "@/components/lens-popup";
import { SelectionIdentity } from "@/components/selection-identity";
import {
  type AgentActivityRegion,
  useAgentActivityRegions,
} from "@/hooks/use-agent-activity-regions";
import { useLineageRegions } from "@/hooks/use-lineage-regions";
import {
  AGENT_ACTIVITY_VISIBILITY_MS,
  type AgentActivityMessage,
  agentCellMarkLabel,
  annotationStatusById,
  latestAgentActivityMessage,
  visibleAnnotations,
} from "@/lib/agent-activity";
import { markerPosition } from "@/lib/annotation-anchors";
import { lineageForTarget, type LineageSummary } from "@/lib/lineage";
import { clamp } from "@/lib/overlay-layout";
import { semanticHighlightRect } from "@/selection/semantic-selection";
import { useLensUiStore } from "@/store";
import type { AgentActivity, LensAnnotation, NotebookGraph, ResolvedHover } from "@/types";

type LensOverlayProps = {
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  graph: NotebookGraph;
  onAddAnnotation: (draft: Omit<LensAnnotation, "id" | "createdAt">) => void;
};

export function LensOverlay({
  annotations,
  agentActivity,
  graph,
  onAddAnnotation,
}: LensOverlayProps) {
  const armed = useLensUiStore((state) => state.armed);
  const hover = useLensUiStore((state) => state.hover);
  const popup = useLensUiStore((state) => state.popup);
  const resetInteraction = useLensUiStore((state) => state.resetInteraction);
  useViewportRevision();
  const measuredHoverRect = hover ? semanticHighlightRect(hover.semanticSelection.highlight) : null;
  const currentHover =
    hover && measuredHoverRect
      ? ({ ...hover, rect: measuredHoverRect } satisfies ResolvedHover)
      : hover;
  const lineage = currentHover
    ? lineageForTarget(currentHover.target, graph, currentHover.displayCellId)
    : null;

  const hoverStyle = currentHover
    ? {
        left: currentHover.rect.left,
        top: currentHover.rect.top,
        width: currentHover.rect.width,
        height: currentHover.rect.height,
      }
    : undefined;

  return (
    <>
      {armed ? <div className="ml-scrim" data-marimo-lens-ui /> : null}
      {currentHover ? (
        <div
          className="ml-highlight"
          style={hoverStyle}
          data-armed={armed ? "true" : "false"}
          data-marimo-lens-ui
        />
      ) : null}
      {lineage ? <LineageRegions lineage={lineage} /> : null}
      {currentHover && lineage && (armed || !popup) ? (
        <HoverCard hover={currentHover} lineage={lineage} />
      ) : null}
      <AgentActivityRegions activity={agentActivity} />
      <AnnotationMarkers annotations={annotations} agentActivity={agentActivity} />
      {popup ? (
        <LensPopup
          popup={popup}
          onSubmit={(draft) => {
            onAddAnnotation(draft);
            resetInteraction();
          }}
          onCancel={resetInteraction}
        />
      ) : null}
    </>
  );
}

function AgentActivityRegions({ activity }: { activity: AgentActivity[] }) {
  const regions = useAgentActivityRegions(activity);
  const message = latestAgentActivityMessage(activity);
  return (
    <>
      {regions.map((region) => (
        <div
          key={region.key}
          className="ml-agent-region"
          style={{
            left: region.rect.left,
            top: region.rect.top,
            width: region.rect.width,
            height: region.rect.height,
          }}
          data-kind={region.kind}
          data-activity={region.activityKind}
          data-active={region.active ? "true" : "false"}
          data-label={agentCellMarkLabel(region)}
          aria-hidden="true"
          data-marimo-lens-ui
        >
          <span className="ml-agent-region__badge">{agentCellMarkLabel(region)}</span>
        </div>
      ))}
      <AgentActivityToast message={message} regions={regions} />
    </>
  );
}

function AgentActivityToast({
  message,
  regions,
}: {
  message: AgentActivityMessage | null;
  regions: AgentActivityRegion[];
}) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const messageId = message?.id;

  useEffect(() => {
    if (!messageId) return undefined;
    const timeout = window.setTimeout(() => {
      setDismissedIds((current) => new Set(current).add(messageId));
    }, AGENT_ACTIVITY_VISIBILITY_MS);
    return () => window.clearTimeout(timeout);
  }, [messageId]);

  if (!message || dismissedIds.has(message.id)) return null;

  return (
    <output
      className="ml-agent-message"
      style={agentMessageStyle(message, regions)}
      data-tone={message.tone}
      aria-live="polite"
      data-marimo-lens-ui
    >
      <span className="ml-agent-message__eyebrow">marimo-pair</span>
      <strong className="ml-agent-message__title">{message.title}</strong>
      <span className="ml-agent-message__body">{message.body}</span>
      <button
        className="ml-agent-message__dismiss"
        type="button"
        aria-label="Dismiss marimo-pair message"
        onClick={() => setDismissedIds((current) => new Set(current).add(message.id))}
        data-marimo-lens-ui
      >
        <IconX size={12} />
      </button>
    </output>
  );
}

function agentMessageStyle(
  message: AgentActivityMessage,
  regions: AgentActivityRegion[],
): CSSProperties {
  const width = 292;
  const margin = 16;
  const anchor =
    regions.find((region) => region.activityId === message.activityId) ??
    regions.find((region) => region.cellId === message.cellId);
  if (!anchor) {
    return {
      left: Math.max(margin, window.innerWidth - width - 20),
      top: 82,
      width,
    };
  }
  return {
    left: clamp(anchor.rect.right - width - 12, margin, window.innerWidth - width - margin),
    top: clamp(anchor.rect.top + 12, 64, Math.max(64, window.innerHeight - 112)),
    width,
  };
}

function HoverCard({ hover, lineage }: { hover: ResolvedHover; lineage: LineageSummary }) {
  return (
    <div
      className="ml-hover-card"
      style={{
        left: clamp(hover.rect.left + hover.rect.width / 2, 120, window.innerWidth - 120),
        top: Math.max(18, hover.rect.top - 34),
      }}
      data-marimo-lens-ui
    >
      <SelectionIdentity hover={hover} />
      <LineageCue lineage={lineage} />
    </div>
  );
}

function LineageRegions({ lineage }: { lineage: LineageSummary }) {
  const regions = useLineageRegions(lineage);
  return (
    <>
      {regions.map((region) => (
        <div
          key={`${region.role}:${region.cellId}`}
          className="ml-lineage-region"
          style={{
            left: region.rect.left,
            top: region.rect.top,
            width: region.rect.width,
            height: region.rect.height,
          }}
          data-role={region.role}
          data-marimo-lens-ui
        />
      ))}
    </>
  );
}

function LineageCue({ lineage }: { lineage: LineageSummary }) {
  const focus = lineage.focusCellIds[0];
  const extraFocusCount = Math.max(0, lineage.focusCellIds.length - 1);
  const upstreamCount = lineage.upstreamCellIds.length;
  const downstreamCount = lineage.downstreamCellIds.length;
  const upstreamLabel = upstreamCount > 0 ? `uses ${upstreamCount}` : "uses none";
  const downstreamLabel = downstreamCount > 0 ? `feeds ${downstreamCount}` : "feeds none";
  const title = lineage.available
    ? `Notebook flow: this output uses ${upstreamCount} upstream ${plural("cell", upstreamCount)} and feeds ${downstreamCount} downstream ${plural("cell", downstreamCount)}.`
    : focus
      ? "Notebook flow is not available for this output yet."
      : "Notebook flow is not available for this selection.";

  return (
    <span className="ml-lineage" aria-label={title} title={title}>
      <span className="ml-lineage__count" data-direction="upstream">
        {upstreamLabel}
      </span>{" "}
      <span className="ml-lineage__rail" aria-hidden="true">
        <span className="ml-lineage__node" data-active={upstreamCount > 0 ? "true" : "false"} />
        <span className="ml-lineage__line" />
        <span
          className="ml-lineage__node ml-lineage__node--focus"
          data-active={focus ? "true" : "false"}
        />
        <span className="ml-lineage__line" />
        <span className="ml-lineage__node" data-active={downstreamCount > 0 ? "true" : "false"} />
      </span>{" "}
      <span className="ml-lineage__focus">
        {focus ? `this cell${extraFocusCount ? ` +${extraFocusCount}` : ""}` : "selection"}
      </span>{" "}
      <span className="ml-lineage__count" data-direction="downstream">
        {downstreamLabel}
      </span>
    </span>
  );
}

function plural(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

function AnnotationMarkers({
  annotations,
  agentActivity,
}: {
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
}) {
  const annotationStatuses = annotationStatusById(agentActivity);
  const activeAnnotations = visibleAnnotations(annotations, agentActivity);
  return (
    <>
      {activeAnnotations.map((annotation, index) => {
        const pos = markerPosition(annotation);
        const receipt = annotationStatuses.get(annotation.id);
        return (
          <button
            key={annotation.id}
            className="ml-marker"
            style={{ left: pos.left, top: pos.top }}
            title={receipt?.note || annotation.comment}
            type="button"
            aria-label={`Lens feedback ${index + 1}: ${annotation.variable || annotation.targetLabel || "target"}${receipt ? `, ${receipt.status}` : ""}`}
            data-agent-status={receipt?.status}
            data-marimo-lens-tooltip="Feedback marker"
            data-marimo-lens-ui
          >
            {index + 1}
          </button>
        );
      })}
    </>
  );
}

function useViewportRevision() {
  const [, setRevision] = useState(0);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setRevision((revision) => revision + 1);
      });
    };

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (document.body) resizeObserver?.observe(document.body);
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    if (document.body) {
      mutationObserver?.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, []);
}
