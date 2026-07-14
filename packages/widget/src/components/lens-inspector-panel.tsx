import {
  Box,
  Braces,
  ChartColumn,
  Search,
  SlidersHorizontal,
  Table2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type {
  AgentActivity,
  LensAnnotation,
  LensTarget,
  LensTargetKind,
  NotebookGraph,
} from "@/types";

import { TargetColumnPager } from "@/components/target-column-pager";
import { agentActivitySummary, visibleAnnotations } from "@/lib/agent-activity";
import { compact, compactTargetKindLabel, shapeText, targetName } from "@/lib/target-labels";
import { orderedTargets } from "@/lib/target-order";
import { formatCount } from "@/lib/text-format";

type LensInspectorPanelProps = {
  title?: string;
  state: "open" | "closing";
  targets: LensTarget[];
  graph: NotebookGraph;
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  selectedTargetId: string | null;
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
  onTargetSelect: (target: LensTarget) => void;
};

export function LensInspectorPanel({
  title,
  state,
  targets,
  graph,
  annotations,
  agentActivity,
  selectedTargetId,
  onTargetEnter,
  onTargetLeave,
  onTargetSelect,
}: LensInspectorPanelProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchOpen ? query.trim().toLowerCase() : "";
  const rows = useMemo(() => {
    const ordered = orderedTargets(targets, graph);
    if (!normalizedQuery) return ordered;
    return ordered.filter((target) => targetMatchesQuery(target, normalizedQuery));
  }, [graph, normalizedQuery, targets]);
  const controlCount =
    (graph.controls?.summary?.uiElementCount ?? 0) + (graph.controls?.summary?.widgetCount ?? 0);
  const noteCount = visibleAnnotations(annotations, agentActivity).length;
  const summary = agentActivitySummary(agentActivity);
  const SearchIcon = searchOpen ? X : Search;

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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
        <div className="ml-inspector-panel__header-actions">
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
          <button
            type="button"
            className="ml-inspector-panel__search-toggle"
            aria-label={searchOpen ? "Close target search" : "Open target search"}
            aria-controls={searchId}
            aria-expanded={searchOpen}
            aria-pressed={searchOpen}
            data-active={searchOpen ? "true" : "false"}
            title={searchOpen ? "Close search" : "Search targets"}
            onClick={() => {
              if (searchOpen) setQuery("");
              setSearchOpen(!searchOpen);
            }}
          >
            <SearchIcon size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      {summary ? <div className="ml-inspector-panel__summary">{summary.text}</div> : null}

      <label
        id={searchId}
        className="ml-target-search"
        data-open={searchOpen ? "true" : "false"}
        inert={!searchOpen}
      >
        <span className="ml-sr-only">Filter Lens targets</span>
        <input
          ref={searchInputRef}
          type="search"
          aria-label="Filter Lens targets"
          disabled={!searchOpen}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setQuery("");
            setSearchOpen(false);
          }}
          placeholder="Filter targets"
        />
      </label>

      <ul className="ml-target-list">
        {rows.length > 0 ? (
          rows.map((target) => (
            <li key={target.id}>
              <TargetRow
                target={target}
                selected={target.id === selectedTargetId}
                onTargetEnter={onTargetEnter}
                onTargetLeave={onTargetLeave}
                onTargetSelect={onTargetSelect}
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
  selected: boolean;
  onTargetEnter: (target: LensTarget) => void;
  onTargetLeave: () => void;
  onTargetSelect: (target: LensTarget) => void;
};

function TargetRow({
  target,
  selected,
  onTargetEnter,
  onTargetLeave,
  onTargetSelect,
}: TargetRowProps) {
  const columns = target.columns ?? [];
  const label = targetName(target);
  return (
    <div
      className="ml-target-row"
      data-selected={selected ? "true" : "false"}
      onFocus={() => onTargetEnter(target)}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        onTargetLeave();
      }}
      onPointerEnter={() => onTargetEnter(target)}
      onPointerLeave={onTargetLeave}
    >
      <button
        type="button"
        className="ml-target-row__select"
        aria-label={targetAriaLabel(target)}
        aria-pressed={selected}
        onClick={() => onTargetSelect(target)}
      >
        <TargetSemanticIcon kind={target.kind} />
        <span className="ml-target-row__body">
          <span className="ml-target-row__top">
            <span className="ml-target-row__name" translate="no">
              {label}
            </span>
          </span>
          <span className="ml-target-row__meta">{targetMeta(target)}</span>
        </span>
      </button>
      {columns.length > 0 ? (
        <TargetColumnPager
          columns={columns}
          targetLabel={label}
          onSelect={() => onTargetSelect(target)}
        />
      ) : null}
    </div>
  );
}

function TargetSemanticIcon({ kind }: { kind: LensTargetKind }) {
  const { Icon, tone } = targetKindIcon(kind);
  return (
    <span className="ml-target-row__icon" data-tone={tone} aria-hidden="true">
      <Icon size={14} strokeWidth={2} />
    </span>
  );
}

type TargetIconTone = "columnar" | "control" | "generic" | "visual" | "warning";

type TargetIconPresentation = {
  Icon: LucideIcon;
  tone: TargetIconTone;
};

const TARGET_KIND_PRESENTATION = {
  anywidget: { Icon: SlidersHorizontal, tone: "control" },
  data: { Icon: Table2, tone: "columnar" },
  dataframe: { Icon: Table2, tone: "columnar" },
  diagnostic: { Icon: TriangleAlert, tone: "warning" },
  document: { Icon: Box, tone: "generic" },
  layout: { Icon: Box, tone: "generic" },
  media: { Icon: Box, tone: "generic" },
  object: { Icon: Braces, tone: "generic" },
  output: { Icon: Box, tone: "generic" },
  table: { Icon: Table2, tone: "columnar" },
  ui: { Icon: SlidersHorizontal, tone: "control" },
  visualization: { Icon: ChartColumn, tone: "visual" },
} satisfies Record<LensTargetKind, TargetIconPresentation>;

function targetKindIcon(kind: LensTargetKind): TargetIconPresentation {
  return TARGET_KIND_PRESENTATION[kind];
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

function targetAriaLabel(target: LensTarget): string {
  return `Preview ${targetName(target)}, ${compactTargetKindLabel(target)}, ${targetMeta(target)}`;
}

function targetMeta(target: LensTarget): string {
  return compactTargetMeta(target) || "notebook value";
}

function compactTargetMeta(target: LensTarget): string {
  return compact([
    shapeText(target, { compact: true }),
    target.cellId ? `cell ${target.cellId}` : null,
  ]);
}
