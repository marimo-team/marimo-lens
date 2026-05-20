import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { IconX } from "@/components/icons";
import { LensTooltip } from "@/components/lens-tooltip";
import { SelectionIdentity } from "@/components/selection-identity";
import { createAnnotationAnchor } from "@/lib/annotation-anchors";
import { formatShape, popupStyle } from "@/lib/overlay-layout";
import { semanticHighlightRect, serializeSemanticSelection } from "@/selection/semantic-selection";
import { FEEDBACK_INTENTS, FEEDBACK_SEVERITIES } from "@/types";
import type { LensAnnotation, PopupState } from "@/types";

type LensPopupProps = {
  popup: PopupState;
  onSubmit: (annotation: Omit<LensAnnotation, "id" | "createdAt">) => void;
  onCancel: () => void;
};

export function LensPopup({ popup, onSubmit, onCancel }: LensPopupProps) {
  const [comment, setComment] = useState("");
  const [intent, setIntent] = useState<LensAnnotation["intent"]>("fix");
  const [severity, setSeverity] = useState<LensAnnotation["severity"]>("important");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const { target, column, displayCellId } = popup.hover;

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    const semanticSelection = serializeSemanticSelection(popup.hover.semanticSelection);
    const rect = semanticHighlightRect(popup.hover.semanticSelection.highlight) ?? popup.hover.rect;
    onSubmit({
      targetId: target.id,
      targetLabel: target.label,
      variable: target.variable,
      kind: target.kind,
      column: column?.name,
      columnDtype: column?.dtype,
      chartPart: popup.hover.chartPart ?? null,
      cellId: target.cellId,
      displayCellId,
      comment: trimmed,
      intent,
      severity,
      element: popup.hover.elementName,
      elementPath: popup.hover.elementPath,
      documentX: rect.left + rect.width / 2 + window.scrollX,
      documentY: rect.top + rect.height / 2 + window.scrollY,
      boundingBox: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      anchor: createAnnotationAnchor(popup.hover),
      semanticSelection,
      context: {
        summary: target.summary,
        defs: target.defs ?? [],
        refs: target.refs ?? [],
        shape: target.shape ?? null,
        pythonType: target.pythonType,
        semanticSelection,
      },
    });
  };
  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return (
    <dialog
      className="ml-popup"
      style={popupStyle(popup)}
      aria-labelledby={titleId}
      open
      data-marimo-lens-ui
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <form className="ml-popup__form" onSubmit={submitForm}>
        <div className="ml-popup__header">
          <div id={titleId}>
            <SelectionIdentity hover={popup.hover} variant="popup" />
            {target.summary ? <div className="ml-popup__summary">{target.summary}</div> : null}
          </div>
          <LensTooltip content="Close without saving this note.">
            <button
              className="ml-icon-button"
              onClick={onCancel}
              type="button"
              aria-label="Close"
              data-marimo-lens-tooltip="Close"
            >
              <IconX size={14} />
            </button>
          </LensTooltip>
        </div>

        <div className="ml-provenance">
          <span>defined in {target.cellId || "unknown cell"}</span>
          {displayCellId ? <span>shown in {displayCellId}</span> : null}
          {formatShape(target) ? <span>{formatShape(target)}</span> : null}
        </div>

        <textarea
          ref={textareaRef}
          className="ml-textarea"
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
          placeholder="What should the agent fix, check, or explain here?"
        />

        <div className="ml-chip-row" aria-label="Feedback intent">
          {FEEDBACK_INTENTS.map((item) => (
            <LensTooltip key={item} content={intentTooltip(item)}>
              <button
                className={item === intent ? "ml-chip ml-chip--selected" : "ml-chip"}
                onClick={() => setIntent(item)}
                type="button"
                aria-pressed={item === intent}
                data-marimo-lens-tooltip={`Intent: ${item}`}
              >
                {item}
              </button>
            </LensTooltip>
          ))}
        </div>

        <div className="ml-popup__footer">
          <div className="ml-chip-row" aria-label="Severity">
            {FEEDBACK_SEVERITIES.map((item) => (
              <LensTooltip key={item} content={severityTooltip(item)}>
                <button
                  className={
                    item === severity ? "ml-dot-chip ml-dot-chip--selected" : "ml-dot-chip"
                  }
                  onClick={() => setSeverity(item)}
                  type="button"
                  aria-pressed={item === severity}
                  data-marimo-lens-tooltip={`Severity: ${item}`}
                >
                  {item}
                </button>
              </LensTooltip>
            ))}
          </div>
          <LensTooltip content="Save this note on the selected notebook output.">
            <button
              className="ml-submit"
              disabled={!comment.trim()}
              type="submit"
              data-marimo-lens-tooltip="Add feedback"
            >
              Add
            </button>
          </LensTooltip>
        </div>
      </form>
    </dialog>
  );
}

function intentTooltip(intent: LensAnnotation["intent"]): string {
  if (intent === "fix") return "Ask marimo-pair to change this.";
  if (intent === "question") return "Ask marimo-pair to investigate this.";
  if (intent === "explain") return "Ask marimo-pair to explain what is happening here.";
  return "Mark this as useful or correct.";
}

function severityTooltip(severity: LensAnnotation["severity"]): string {
  if (severity === "blocking") return "This blocks the notebook goal.";
  if (severity === "important") return "This should be handled in the next pass.";
  return "This is useful context, but not urgent.";
}
