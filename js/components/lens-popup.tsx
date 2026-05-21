import { X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent } from "react";

import type { LensAnnotation, PopupState } from "@/types";

import { LensTooltip } from "@/components/lens-tooltip";
import { SelectionIdentity } from "@/components/selection-identity";
import { createFeedbackDraft } from "@/feedback/create-feedback-draft";
import { formatShape, popupStyle } from "@/lib/overlay-layout";
import { useLensUiStore } from "@/store";
import { FEEDBACK_INTENTS, FEEDBACK_SEVERITIES } from "@/types";

const INTENT_META: Record<LensAnnotation["intent"], { label: string; tooltip: string }> = {
  approve: {
    label: "Approve",
    tooltip: "Mark this as useful or correct.",
  },
  explain: {
    label: "Explain",
    tooltip: "Ask marimo-pair to explain what is happening here.",
  },
  fix: {
    label: "Change",
    tooltip: "Ask marimo-pair to change this.",
  },
  question: {
    label: "Question",
    tooltip: "Ask marimo-pair to investigate this.",
  },
};

const SEVERITY_META: Record<LensAnnotation["severity"], { label: string; tooltip: string }> = {
  blocking: {
    label: "Blocking",
    tooltip: "This blocks the notebook goal.",
  },
  important: {
    label: "Important",
    tooltip: "This should be handled in the next pass.",
  },
  suggestion: {
    label: "Suggestion",
    tooltip: "This is useful context, but not urgent.",
  },
};

type LensPopupProps = {
  popup: PopupState;
  onSubmit: (annotation: Omit<LensAnnotation, "id" | "createdAt">) => void;
  onCancel: () => void;
};

export function LensPopup({ popup, onSubmit, onCancel }: LensPopupProps) {
  const { comment, intent, severity } = useLensUiStore((state) => state.popupDraft);
  const updatePopupDraft = useLensUiStore((state) => state.updatePopupDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const { target, displayCellId } = popup.hover;
  const targetShape = formatShape(target);
  const canSubmit = Boolean(comment.trim());
  const submitTooltip = canSubmit
    ? "Save this note on the selected notebook output."
    : "Write a note before saving.";

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onSubmit(createFeedbackDraft({ popup, comment: trimmed, intent, severity }));
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
              <X size={14} strokeWidth={1.8} />
            </button>
          </LensTooltip>
        </div>

        <div className="ml-provenance">
          <span>defined in {target.cellId || "unknown cell"}</span>
          {displayCellId ? <span>shown in {displayCellId}</span> : null}
          {targetShape ? <span>{targetShape}</span> : null}
        </div>

        <textarea
          ref={textareaRef}
          className="ml-textarea"
          aria-label="Feedback comment"
          name="feedback"
          autoComplete="off"
          value={comment}
          onChange={(event) => updatePopupDraft({ comment: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") onCancel();
          }}
          placeholder="Describe the change, question, or issue…"
        />

        <fieldset className="ml-chip-row">
          <legend className="ml-sr-only">Feedback intent</legend>
          {FEEDBACK_INTENTS.map((item) => (
            <LensTooltip key={item} content={INTENT_META[item].tooltip}>
              <button
                className={item === intent ? "ml-chip ml-chip--selected" : "ml-chip"}
                onClick={() => updatePopupDraft({ intent: item })}
                type="button"
                aria-pressed={item === intent}
                data-marimo-lens-tooltip={`Intent: ${INTENT_META[item].label}`}
              >
                {INTENT_META[item].label}
              </button>
            </LensTooltip>
          ))}
        </fieldset>

        <div className="ml-popup__footer">
          <fieldset className="ml-chip-row">
            <legend className="ml-sr-only">Severity</legend>
            {FEEDBACK_SEVERITIES.map((item) => (
              <LensTooltip key={item} content={SEVERITY_META[item].tooltip}>
                <button
                  className={
                    item === severity ? "ml-dot-chip ml-dot-chip--selected" : "ml-dot-chip"
                  }
                  onClick={() => updatePopupDraft({ severity: item })}
                  type="button"
                  aria-pressed={item === severity}
                  data-marimo-lens-tooltip={`Severity: ${SEVERITY_META[item].label}`}
                >
                  {SEVERITY_META[item].label}
                </button>
              </LensTooltip>
            ))}
          </fieldset>
          <LensTooltip content={submitTooltip}>
            <button
              className="ml-submit"
              disabled={!canSubmit}
              type="submit"
              data-marimo-lens-tooltip="Add note"
            >
              Add note
            </button>
          </LensTooltip>
        </div>
      </form>
    </dialog>
  );
}
