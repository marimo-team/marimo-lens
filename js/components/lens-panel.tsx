import { AnnotationFeed } from "@/components/annotation-feed";
import { LensActions } from "@/components/lens-actions";
import { TargetStrip } from "@/components/target-strip";
import { agentActivitySummary, visibleAnnotations } from "@/lib/agent-activity";
import type { AgentActivity, LensAnnotation, LensTarget, NotebookGraph } from "@/types";

type LensPanelProps = {
  title?: string;
  targets: LensTarget[];
  graph: NotebookGraph;
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  armed: boolean;
  copied: boolean;
  copying: boolean;
  onCopy: () => void;
  onScan: () => void;
  onClear: () => void;
  onRemove: (id: string) => void;
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
  onToggleCapture: () => void;
};

export function LensPanel({
  title,
  targets,
  graph,
  annotations,
  agentActivity,
  armed,
  copied,
  copying,
  onCopy,
  onScan,
  onClear,
  onRemove,
  onTargetEnter,
  onTargetLeave,
  onToggleCapture,
}: LensPanelProps) {
  const activeAnnotations = visibleAnnotations(annotations, agentActivity);
  const count = activeAnnotations.length;
  const controlCount =
    (graph.controls?.summary?.uiElementCount ?? 0) + (graph.controls?.summary?.widgetCount ?? 0);
  const agentSummary = agentActivitySummary(agentActivity);
  return (
    <div className="ml-panel">
      <div className="ml-panel__top">
        <div>
          <div className="ml-panel__title">{title || "marimo lens"}</div>
          <div className="ml-panel__meta">
            {formatCount(targets.length, "item")}
            <span />
            {formatCount(controlCount, "control")}
            <span />
            {graph.available ? "flow ready" : "manual context"}
          </div>
        </div>
        <div className="ml-panel__status">
          <div className="ml-count">{count}</div>
          <span className={graph.available ? "ml-graph-dot" : "ml-graph-dot ml-graph-dot--muted"} />
        </div>
      </div>

      {agentSummary ? (
        <div className="ml-agent-summary" title={agentSummary.text}>
          {agentSummary.text}
        </div>
      ) : null}
      <TargetStrip targets={targets} onTargetEnter={onTargetEnter} onTargetLeave={onTargetLeave} />
      <LensActions
        armed={armed}
        copied={copied}
        copying={copying}
        disabled={!count || copying}
        onCopy={onCopy}
        onScan={onScan}
        onClear={onClear}
        onToggleCapture={onToggleCapture}
      />
      {count > 0 ? (
        <AnnotationFeed
          annotations={activeAnnotations}
          agentActivity={agentActivity}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}
