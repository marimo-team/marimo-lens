import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type { AgentActivity, LensAnnotation } from "@/types";

import { annotationStatusById, visibleAnnotations } from "@/lib/agent-activity";
import { markerPosition } from "@/lib/annotation-anchors";
import { clamp } from "@/lib/dom-geometry";

type AnnotationPatch = Partial<Pick<LensAnnotation, "comment">>;
type AnnotationReceipt =
  ReturnType<typeof annotationStatusById> extends Map<string, infer Receipt> ? Receipt : never;

type MarkerPoint = {
  left: number;
  top: number;
};

type PositionedAnnotation = {
  annotation: LensAnnotation;
  index: number;
  position: MarkerPoint;
  receipt?: AnnotationReceipt;
};

type AnnotationMarkersProps = {
  annotations: LensAnnotation[];
  agentActivity: AgentActivity[];
  onUpdateAnnotation: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation: (id: string) => void;
};

export function AnnotationMarkers({
  annotations,
  agentActivity,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: AnnotationMarkersProps) {
  const annotationStatuses = annotationStatusById(agentActivity);
  const activeAnnotations = visibleAnnotations(annotations, agentActivity);
  const markers = activeAnnotations.flatMap((annotation, index): PositionedAnnotation[] => {
    const position = markerPosition(annotation);
    if (!position) return [];
    return [
      {
        annotation,
        index,
        position,
        receipt: annotationStatuses.get(annotation.id),
      },
    ];
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoveredMarker = markers.find((marker) => marker.annotation.id === hoveredId);
  const editingMarker = markers.find((marker) => marker.annotation.id === editingId);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const showHover = useCallback(
    (id: string) => {
      clearHoverTimer();
      if (!editingId) setHoveredId(id);
    },
    [clearHoverTimer, editingId],
  );

  const scheduleHideHover = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => setHoveredId(null), 90);
  }, [clearHoverTimer]);

  const beginEdit = useCallback(
    (id: string) => {
      clearHoverTimer();
      setHoveredId(null);
      setEditingId(id);
    },
    [clearHoverTimer],
  );

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  useEffect(() => {
    if (editingId && !activeAnnotations.some((annotation) => annotation.id === editingId)) {
      setEditingId(null);
    }
  }, [activeAnnotations, editingId]);

  return (
    <>
      {markers.map(({ annotation, index, position, receipt }) => (
        <button
          key={annotation.id}
          className="ml-marker"
          style={{ left: position.left, top: position.top }}
          type="button"
          aria-label={`Lens feedback ${index + 1}: ${annotation.variable || annotation.targetLabel || "target"}${receipt ? `, ${receipt.status}` : ""}`}
          data-agent-status={receipt?.status}
          data-marimo-lens-ui
          onClick={() => beginEdit(annotation.id)}
          onFocus={() => showHover(annotation.id)}
          onBlur={scheduleHideHover}
          onPointerEnter={() => showHover(annotation.id)}
          onPointerLeave={scheduleHideHover}
        >
          {index + 1}
        </button>
      ))}

      {hoveredMarker && hoveredMarker.annotation.id !== editingId ? (
        <AnnotationMarkerHoverCard
          marker={hoveredMarker}
          onEdit={() => beginEdit(hoveredMarker.annotation.id)}
          onPointerEnter={() => showHover(hoveredMarker.annotation.id)}
          onPointerLeave={scheduleHideHover}
        />
      ) : null}

      {editingMarker ? (
        <AnnotationMarkerEditor
          key={editingMarker.annotation.id}
          marker={editingMarker}
          onSave={(patch) => {
            onUpdateAnnotation(editingMarker.annotation.id, patch);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
          onDelete={() => {
            onDeleteAnnotation(editingMarker.annotation.id);
            setEditingId(null);
          }}
        />
      ) : null}
    </>
  );
}

function AnnotationMarkerHoverCard({
  marker,
  onEdit,
  onPointerEnter,
  onPointerLeave,
}: {
  marker: PositionedAnnotation;
  onEdit: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const summary = semanticSummary(marker.annotation);
  const body = marker.receipt?.note || marker.annotation.comment;
  return (
    <div
      className="ml-marker-tooltip"
      style={markerTooltipStyle(marker.position)}
      role="tooltip"
      data-marimo-lens-ui
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="ml-marker-tooltip__copy">
        {summary ? <span className="ml-marker-tooltip__summary">{summary}</span> : null}
        <span className="ml-marker-tooltip__note">{body}</span>
      </div>
      <button
        className="ml-marker-tooltip__edit"
        type="button"
        aria-label={`Edit feedback ${marker.index + 1}`}
        onClick={onEdit}
      >
        <Pencil size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

function AnnotationMarkerEditor({
  marker,
  onSave,
  onCancel,
  onDelete,
}: {
  marker: PositionedAnnotation;
  onSave: (patch: AnnotationPatch) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { annotation } = marker;
  const [comment, setComment] = useState(annotation.comment);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shaking, setShaking] = useState(false);
  const popupRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const blockNextClickRef = useRef(false);
  const canSave = Boolean(comment.trim());
  const details = semanticDetails(annotation);
  const summary = semanticSummary(annotation) || annotation.element || "selected output";

  const shake = useCallback(() => {
    if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
    setShaking(false);
    window.requestAnimationFrame(() => {
      setShaking(true);
      shakeTimerRef.current = window.setTimeout(() => {
        setShaking(false);
        textareaRef.current?.focus();
      }, 260);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    }, 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const isOutsidePopup = (target: EventTarget | null) => {
      const popup = popupRef.current;
      return Boolean(popup && target instanceof Node && !popup.contains(target));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isOutsidePopup(event.target)) return;
      blockNextClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      shake();
    };
    const onClick = (event: MouseEvent) => {
      if (!blockNextClickRef.current || !isOutsidePopup(event.target)) return;
      blockNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [shake]);

  useEffect(
    () => () => {
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
    },
    [],
  );

  const submit = () => {
    const trimmed = comment.trim();
    if (!trimmed) {
      shake();
      return;
    }
    onSave({ comment: trimmed });
  };

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return (
    <form
      ref={popupRef}
      className={shaking ? "ml-marker-editor ml-marker-editor--shake" : "ml-marker-editor"}
      style={markerEditorStyle(marker.position)}
      aria-label={`Edit feedback ${marker.index + 1}`}
      data-marimo-lens-ui
      onSubmit={submitForm}
    >
      <button
        className="ml-marker-editor__summary"
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {detailsOpen ? (
          <ChevronDown size={15} strokeWidth={2} />
        ) : (
          <ChevronRight size={15} strokeWidth={2} />
        )}
        <span>{summary}</span>
      </button>

      {details.length ? (
        <div
          className="ml-marker-editor__details"
          data-open={detailsOpen ? "true" : "false"}
          aria-hidden={detailsOpen ? undefined : true}
        >
          <dl className="ml-marker-editor__details-inner">
            {details.map((item) => (
              <div key={item.label} className="ml-marker-editor__detail">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className="ml-marker-editor__textarea"
        aria-label="Feedback comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") onCancel();
        }}
      />

      <div className="ml-marker-editor__actions">
        <button
          className="ml-marker-editor__delete"
          type="button"
          aria-label={`Delete feedback ${marker.index + 1}`}
          onClick={onDelete}
        >
          <Trash2 size={17} strokeWidth={2} />
        </button>
        <button className="ml-marker-editor__cancel" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="ml-marker-editor__save" type="submit" disabled={!canSave}>
          Save
        </button>
      </div>
    </form>
  );
}

function markerTooltipStyle(position: MarkerPoint): CSSProperties {
  const width = 300;
  const margin = 14;
  const left = clamp(
    position.left,
    margin + width / 2,
    Math.max(margin + width / 2, window.innerWidth - margin - width / 2),
  );
  const belowTop = position.top + 28;
  const placeAbove = belowTop > window.innerHeight - 82;
  return {
    left,
    top: placeAbove ? Math.max(margin, position.top - 10) : belowTop,
    transform: placeAbove ? "translate(-50%, -100%)" : "translateX(-50%)",
  };
}

function markerEditorStyle(position: MarkerPoint): CSSProperties {
  const width = 326;
  const margin = 14;
  const left = clamp(
    position.left,
    margin + width / 2,
    Math.max(margin + width / 2, window.innerWidth - margin - width / 2),
  );
  const belowTop = position.top + 24;
  if (belowTop > window.innerHeight - 320) {
    return {
      left,
      bottom: clamp(window.innerHeight - position.top + 20, margin, window.innerHeight - margin),
    };
  }
  return {
    left,
    top: Math.max(margin, belowTop),
  };
}

type SemanticSummaryRule = {
  matches: (annotation: LensAnnotation) => boolean;
  parts: (annotation: LensAnnotation) => Array<string | null | undefined>;
};

const SEMANTIC_SUMMARY_RULES: SemanticSummaryRule[] = [
  {
    matches: (annotation) => Boolean(annotation.column),
    parts: (annotation) => [
      `column ${annotation.column}`,
      annotationTargetLabel(annotation),
      annotationCellLabel(annotation),
    ],
  },
  {
    matches: (annotation) => Boolean(annotation.chartPart),
    parts: (annotation) => [
      annotation.chartPart && `${annotation.chartPart.kind} ${annotation.chartPart.label}`,
      annotationCellLabel(annotation),
    ],
  },
  {
    matches: (annotation) => Boolean(annotation.semanticSelection?.label),
    parts: (annotation) => [annotation.semanticSelection?.label, annotationCellLabel(annotation)],
  },
  {
    matches: () => true,
    parts: (annotation) => [annotationTargetLabel(annotation), annotationCellLabel(annotation)],
  },
];

function semanticSummary(annotation: LensAnnotation): string {
  const rule = SEMANTIC_SUMMARY_RULES.find((item) => item.matches(annotation));
  return joinParts(rule?.parts(annotation) ?? []);
}

function annotationTargetLabel(annotation: LensAnnotation): string | undefined {
  return annotation.variable || annotation.targetLabel;
}

function annotationCellLabel(annotation: LensAnnotation): string | undefined {
  const cell = annotation.displayCellId || annotation.cellId;
  return cell ? `cell ${cell}` : undefined;
}

function semanticDetails(annotation: LensAnnotation): Array<{ label: string; value: string }> {
  const target = annotation.targetSnapshot;
  const shape = target?.shape;
  const semantic = annotation.semanticSelection;
  const chartPart = annotation.chartPart;
  const evidenceKinds = semantic
    ? [...new Set(semantic.evidence.map((evidence) => evidence.kind).filter(Boolean))]
    : [];
  return [
    {
      label: "Target",
      value: joinParts([annotation.variable, annotation.targetLabel, annotation.kind]),
    },
    {
      label: "Cell",
      value: joinParts([
        annotation.displayCellId && `shown in ${annotation.displayCellId}`,
        annotation.cellId && `defined in ${annotation.cellId}`,
      ]),
    },
    {
      label: "Shape",
      value: shape
        ? joinParts([
            typeof shape.rows === "number" ? `${shape.rows} rows` : null,
            typeof shape.columns === "number" ? `${shape.columns} columns` : null,
          ])
        : null,
    },
    { label: "Column", value: joinParts([annotation.column, annotation.columnDtype]) },
    {
      label: "Chart part",
      value: chartPart
        ? joinParts([
            chartPart.label,
            chartPart.kind,
            chartPart.field && `field ${chartPart.field}`,
            chartPart.channel && `channel ${chartPart.channel}`,
            chartPart.library,
          ])
        : null,
    },
    {
      label: "Selection",
      value: semantic ? joinParts([semantic.label, semantic.kind, semantic.granularity]) : null,
    },
    { label: "Evidence", value: evidenceKinds.length ? evidenceKinds.join(", ") : null },
    { label: "Element", value: annotation.element || null },
  ].flatMap(compactDetail);
}

function compactDetail(item: { label: string; value: string | null }): Array<{
  label: string;
  value: string;
}> {
  const value = item.value?.trim();
  return value ? [{ label: item.label, value }] : [];
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
