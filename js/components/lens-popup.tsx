import { useEffect, useId, useRef, type FormEvent } from "react";

import type { LensAnnotation, PopupState } from "@/types";

import { SelectionIdentityIcon } from "@/components/selection-identity";
import { createFeedbackDraft } from "@/feedback/create-feedback-draft";
import { popupStyle } from "@/lib/overlay-layout";
import { useLensUiStore } from "@/store";

type LensPopupProps = {
  popup: PopupState;
  onSubmit: (annotation: Omit<LensAnnotation, "id" | "createdAt">) => void;
  onCancel: () => void;
};

export function LensPopup({ popup, onSubmit, onCancel }: LensPopupProps) {
  const { comment } = useLensUiStore((state) => state.popupDraft);
  const updatePopupDraft = useLensUiStore((state) => state.updatePopupDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const canSubmit = Boolean(comment.trim());
  const selectionTitle = popupSelectionTitle(popup);

  useEffect(() => {
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onSubmit(createFeedbackDraft({ popup, comment: trimmed }));
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
        <div className="ml-popup__selection" id={titleId}>
          <SelectionIdentityIcon hover={popup.hover} size={15} />
          <span>{selectionTitle}</span>
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
          placeholder="Ask a question or request a change..."
        />

        <div className="ml-popup__footer">
          <button className="ml-popup__cancel" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="ml-submit" disabled={!canSubmit} type="submit">
            Add
          </button>
        </div>
      </form>
    </dialog>
  );
}

function popupSelectionTitle({ hover }: PopupState): string {
  const { chartPart, column, semanticSelection, target } = hover;
  if (chartPart) {
    const datum = datumSummary(chartPart.datum);
    return [readableKind(chartPart.kind), chartPart.label, datum].filter(Boolean).join(": ");
  }
  if (column) return `column: ${column.name}`;
  if (!["output", "surface", "target"].includes(semanticSelection.kind)) {
    return `${readableKind(semanticSelection.kind)}: ${semanticSelection.label}`;
  }
  if (target.variable) return target.variable;
  if (target.cellId) return `cell ${target.cellId}`;
  return cleanTargetLabel(target.label);
}

function readableKind(kind: string): string {
  return kind.replace(/-/g, " ");
}

function cleanTargetLabel(label: string): string {
  return label
    .replace(/^(?:chart|table|image|media|document|layout)?\s*output\s+from\s+/i, "")
    .replace(/\s+output$/i, "")
    .trim();
}

function datumSummary(datum: Record<string, unknown> | undefined): string {
  if (!datum) return "";
  return Object.entries(datum)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}
