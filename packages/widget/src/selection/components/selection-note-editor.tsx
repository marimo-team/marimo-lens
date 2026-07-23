import type { Selection } from "@marimo-lens/protocol";

import { Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { anchorToViewport } from "@/selection/anchor";
import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { useAnchoredSurface, type AnchoredSurfaceAnchor } from "@/ui/anchored-surface";

type SelectionNoteEditorProps = {
  selection: Selection;
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
  initialNote,
  saving,
  mutationPending,
  motion,
  saveError,
  onSave,
  onCancel,
  onDelete,
}: SelectionNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initialNote);
  const headingId = useId();
  const errorId = useId();
  const dom = useNotebookDom();
  const anchor = editorAnchor(
    dom.getOutputCell(selection.outputCellId)?.element ?? null,
    selection,
  );
  const position = useAnchoredSurface({
    anchor,
    open: true,
    preferredPlacement: anchor && anchor.rect.top < 300 ? "below" : "above",
    gap: 18,
    width: 352,
    surfaceHeight: 240,
    fallback: { style: { right: 16, bottom: 72 }, placement: "above" },
  });

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.select();
  }, []);

  const title = selection.note ? "Edit note" : "Add note";
  return (
    <section
      className="ml-note-editor"
      style={position.style}
      data-placement={position.placement}
      data-instant={motion === "instant" ? "true" : "false"}
      data-marimo-lens-note-editor
      data-marimo-lens-selection-cluster={selection.id}
      data-marimo-lens-ui
      aria-labelledby={headingId}
    >
      <header className="ml-note-editor__header">
        <span className="ml-label">{selection.label}</span>
        <div className="ml-note-editor__identity">
          <h2 id={headingId}>{title}</h2>
          <span>
            Cell <span className="ml-code">{selection.outputCellId}</span>
            <SelectionKindMark kind={selection.anchor.kind} />
          </span>
        </div>
        <button
          className="ml-icon-button"
          type="button"
          onClick={onCancel}
          disabled={mutationPending}
          aria-label="Close note editor"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <label className="ml-visually-hidden" htmlFor={`${headingId}-field`}>
        Note for selection {selection.label}
      </label>
      <textarea
        id={`${headingId}-field`}
        ref={textareaRef}
        className="ml-note-editor__input"
        value={draft}
        maxLength={4_000}
        rows={3}
        placeholder="Add context for this selection"
        disabled={mutationPending}
        aria-invalid={saveError ? "true" : undefined}
        aria-describedby={saveError ? errorId : undefined}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!mutationPending) onSave(draft);
          }
        }}
      />

      {saveError ? (
        <p id={errorId} className="ml-note-editor__error" role="alert">
          {saveError}
        </p>
      ) : null}

      <footer className="ml-note-editor__footer">
        <button
          className="ml-button ml-button--danger"
          type="button"
          onClick={onDelete}
          disabled={mutationPending}
        >
          <Trash2 size={14} aria-hidden="true" /> Remove selection
        </button>
        <button
          className="ml-button ml-button--primary"
          type="button"
          onClick={() => onSave(draft)}
          disabled={mutationPending}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          title="Save note (Command/Ctrl+Enter)"
        >
          {saving ? "Saving…" : "Done"}
        </button>
      </footer>
    </section>
  );
}

function editorAnchor(
  output: HTMLElement | null,
  selection: Selection,
): AnchoredSurfaceAnchor | null {
  if (!output) return null;
  const viewportAnchor = anchorToViewport(output, selection.anchor);
  const x =
    viewportAnchor.kind === "point"
      ? viewportAnchor.x
      : viewportAnchor.x + viewportAnchor.width / 2;
  const y = viewportAnchor.y;
  return {
    element: output,
    rect: { left: x, right: x, top: y, bottom: y, width: 0, height: 0 },
  };
}
