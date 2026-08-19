import type { Selection, TargetSelector } from "@marimo-lens/protocol";

import { Trash2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { anchorToViewport } from "@/selection/anchor";
import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { targetLabel, targetTitle } from "@/selection/target-label";
import { useAnchoredSurface, type AnchoredSurfaceAnchor } from "@/ui/anchored-surface";

type SelectionNoteEditorProps = {
  selection: Selection;
  selector: TargetSelector;
  initialNote: string;
  saving: boolean;
  mutationPending: boolean;
  motion: "animate" | "instant";
  saveError?: string;
  onSave: (note: string) => void;
  onCancel: () => void;
  onDelete: () => void;
};

export function SelectionNoteEditor({
  selection,
  selector,
  initialNote,
  saving,
  mutationPending,
  motion,
  saveError,
  onSave,
  onCancel,
  onDelete,
}: SelectionNoteEditorProps) {
  const surfaceRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialNote);
  const fieldId = useId();
  const errorId = useId();
  const dom = useNotebookDom();
  const anchor = editorAnchor(
    dom.getTarget(selection.target, selector)?.element ?? null,
    selection,
  );
  const position = useAnchoredSurface({
    anchor,
    open: true,
    preferredPlacement: anchor && anchor.rect.top < 300 ? "below" : "above",
    gap: 8,
    width: 320,
    surfaceHeight: 190,
    fallback: { style: { right: 16, bottom: 72 }, placement: "above" },
  });

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (!surface.open) surface.showModal();
    return () => {
      if (surface.open) surface.close();
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const title = selection.note ? "Edit note" : "Add note";
  return (
    <dialog
      ref={surfaceRef}
      className="ml-note-editor"
      style={{ inset: "auto", ...position.style }}
      data-placement={position.placement}
      data-instant={motion === "instant" ? "true" : "false"}
      data-marimo-lens-note-editor
      data-marimo-lens-selection-cluster={selection.id}
      data-marimo-lens-ui
      aria-label={`${title} for ${selection.label}, ${targetLabel(selection.target, selection.domHint)}`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        textareaRef.current?.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "textarea:not(:disabled), button:not(:disabled)",
          ),
        );
        const first = controls[0];
        const last = controls.at(-1);
        const active = event.currentTarget.ownerDocument.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }}
    >
      <header className="ml-note-editor__header">
        <span className="ml-note-editor__selection ml-code">{selection.label}</span>
        <span aria-hidden="true">·</span>
        <span className="ml-note-editor__target" title={targetTitle(selection.target)}>
          <span className="ml-code">{targetLabel(selection.target, selection.domHint)}</span>
        </span>
        <SelectionKindMark kind={selection.anchor.kind} />
      </header>

      <label className="ml-visually-hidden" htmlFor={fieldId}>
        Note for selection {selection.label}
      </label>
      <textarea
        id={fieldId}
        ref={textareaRef}
        className="ml-note-editor__input"
        value={draft}
        maxLength={4_000}
        rows={3}
        placeholder="Add a note (optional)"
        disabled={mutationPending}
        aria-invalid={saveError ? "true" : undefined}
        aria-describedby={saveError ? errorId : undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />

      {saveError ? (
        <p id={errorId} className="ml-note-editor__error" role="alert">
          {saveError}
        </p>
      ) : null}

      <footer className="ml-note-editor__footer">
        <button
          className="ml-icon-button ml-icon-button--danger"
          type="button"
          onClick={onDelete}
          disabled={mutationPending}
          aria-label={`Remove selection ${selection.label}`}
          title="Remove selection"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
        <span className="ml-note-editor__actions">
          <button className="ml-button" type="button" onClick={onCancel} disabled={mutationPending}>
            Cancel
          </button>
          <button
            className="ml-button ml-button--primary"
            type="button"
            onClick={() => onSave(draft)}
            disabled={mutationPending}
          >
            {saving ? "Saving…" : "Done"}
          </button>
        </span>
      </footer>
    </dialog>
  );
}

function editorAnchor(
  output: HTMLElement | null,
  selection: Selection,
): AnchoredSurfaceAnchor | null {
  if (!output) return null;
  const viewportAnchor = anchorToViewport(output, selection.anchor);
  const markerTop =
    selection.anchor.kind === "point" ? viewportAnchor.y - 12 : viewportAnchor.y - 25;
  const markerBottom = selection.anchor.kind === "point" ? viewportAnchor.y + 12 : viewportAnchor.y;
  return {
    element: output,
    rect: {
      left: viewportAnchor.x,
      right: viewportAnchor.x,
      top: markerTop,
      bottom: markerBottom,
      width: 0,
      height: markerBottom - markerTop,
    },
  };
}
