import { useMemo, useState } from "react";

import type { AgentActivity, LensAnnotation, LensTarget, NotebookGraph } from "@/types";

import { agentActivitySummary, visibleAnnotations } from "@/lib/agent-activity";
import { compactTargetKindLabel, shapeText, targetName } from "@/lib/target-labels";
import { formatCount } from "@/lib/text-format";

type LensInspectorPanelProps = {
  title?: string;
  state: "open" | "closing";
  targets: LensTarget[];
  graph: NotebookGraph;
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
};

export function LensInspectorPanel({
  title,
  state,
  targets,
  graph,
  annotations,
  agentActivity,
  onTargetEnter,
  onTargetLeave,
}: LensInspectorPanelProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const ordered = orderedTargets(targets);
    if (!normalizedQuery) return ordered;
    return ordered.filter((target) => targetMatchesQuery(target, normalizedQuery));
  }, [normalizedQuery, targets]);
  const controlCount =
    (graph.controls?.summary?.uiElementCount ?? 0) + (graph.controls?.summary?.widgetCount ?? 0);
  const noteCount = visibleAnnotations(annotations, agentActivity).length;
  const summary = agentActivitySummary(agentActivity);

  return (
    <section
      className="ml-inspector-panel"
      aria-label="Lens target inspector"
      aria-hidden={state === "closing" ? "true" : undefined}
      data-state={state}
      inert={state === "closing"}
    >
      <div className="ml-inspector-panel__header">
        <div className="ml-inspector-panel__title">{title || "marimo lens"}</div>
        <div className="ml-inspector-panel__meta">
          {formatCount(targets.length, "target")}
          <span aria-hidden="true" />
          {formatCount(controlCount, "control")}
          {noteCount > 0 ? (
            <>
              <span aria-hidden="true" />
              {formatCount(noteCount, "note")}
            </>
          ) : null}
        </div>
      </div>

      {summary ? <div className="ml-inspector-panel__summary">{summary.text}</div> : null}

      <label className="ml-target-search">
        <span className="ml-sr-only">Filter Lens targets</span>
        <input
          type="search"
          aria-label="Filter Lens targets"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Filter targets"
        />
      </label>

      <ul className="ml-target-list">
        {rows.length > 0 ? (
          rows.map((target) => (
            <li key={target.id}>
              <TargetRow
                target={target}
                onTargetEnter={onTargetEnter}
                onTargetLeave={onTargetLeave}
              />
            </li>
          ))
        ) : (
          <li className="ml-target-list__empty">
            {targets.length > 0 ? "No targets match this filter." : "No notebook targets found."}
          </li>
        )}
      </ul>

      {targets.length > 0 ? (
        <div className="ml-inspector-panel__more" aria-live="polite">
          {formatCount(rows.length, "visible target")} of {formatCount(targets.length, "target")}
        </div>
      ) : null}
    </section>
  );
}

type TargetRowProps = {
  target: LensTarget;
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
};

function TargetRow({ target, onTargetEnter, onTargetLeave }: TargetRowProps) {
  const columnNames = (target.columns ?? []).map((column) => column.name);
  return (
    <button
      type="button"
      className="ml-target-row"
      onFocus={() => onTargetEnter(target)}
      onBlur={onTargetLeave}
      onPointerEnter={() => onTargetEnter(target)}
      onPointerLeave={onTargetLeave}
      aria-label={targetAriaLabel(target)}
    >
      <span className="ml-target-row__dot" data-kind={target.kind} aria-hidden="true" />
      <span className="ml-target-row__body">
        <span className="ml-target-row__top">
          <span className="ml-target-row__name" translate="no">
            {targetName(target)}
          </span>
          <span className="ml-target-row__kind">{compactTargetKindLabel(target)}</span>
        </span>
        <span className="ml-target-row__meta">{targetMeta(target)}</span>
        {columnNames.length > 0 ? (
          <span className="ml-target-row__columns" aria-hidden="true">
            {columnNames.map((name) => (
              <span key={name} translate="no">
                {name}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function orderedTargets(targets: LensTarget[]): LensTarget[] {
  return [...targets].sort((left, right) => {
    const priority = targetPriority(left) - targetPriority(right);
    if (priority !== 0) return priority;
    return targetName(left).localeCompare(targetName(right));
  });
}

function targetMatchesQuery(target: LensTarget, query: string): boolean {
  const haystack = [
    target.variable,
    target.label,
    target.kind,
    target.summary,
    target.pythonType,
    ...(target.columns ?? []).map((column) => `${column.name} ${column.dtype ?? ""}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function targetPriority(target: LensTarget): number {
  if (target.kind === "dataframe" || target.kind === "table" || target.kind === "data") return 0;
  if (target.kind === "visualization" || target.capabilities?.chartPart) return 1;
  if (target.kind === "ui" || target.kind === "anywidget") return 2;
  if (target.kind === "output") return 4;
  return 3;
}

function targetAriaLabel(target: LensTarget): string {
  return `Preview ${targetName(target)}, ${compactTargetKindLabel(target)}, ${targetMeta(target)}`;
}

function targetMeta(target: LensTarget): string {
  const parts = [
    shapeText(target, { compact: true }),
    target.cellId ? `cell ${target.cellId}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "notebook value";
}
