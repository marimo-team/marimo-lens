import type { Selection } from "@marimo-lens/protocol";

import { Trash2 } from "lucide-react";
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
  const surfaceRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attentionAnimationRef = useRef<Animation | null>(null);
  const refocusTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState(initialNote);
  const fieldId = useId();
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
    gap: 8,
    width: 320,
    surfaceHeight: 190,
    fallback: { style: { right: 16, bottom: 72 }, placement: "above" },
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const onOutsidePointerDown = (event: PointerEvent) => {
      const surface = surfaceRef.current;
      if (
        !surface ||
        !(event.target instanceof dom.window.Node) ||
        surface.contains(event.target)
      ) {
        return;
      }

      attentionAnimationRef.current?.cancel();
      const reducedMotion = dom.window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reducedMotion && typeof surface.animate === "function") {
        attentionAnimationRef.current = surface.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-3px)" },
            { transform: "translateX(3px)" },
            { transform: "translateX(-2px)" },
            { transform: "translateX(2px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 240, easing: "ease-out" },
        );
      }

      if (refocusTimerRef.current !== null) {
        dom.window.clearTimeout(refocusTimerRef.current);
      }
      refocusTimerRef.current = dom.window.setTimeout(
        () => textareaRef.current?.focus({ preventScroll: true }),
        reducedMotion ? 0 : 240,
      );
    };

    dom.document.addEventListener("pointerdown", onOutsidePointerDown, true);
    return () => {
      dom.document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      attentionAnimationRef.current?.cancel();
      if (refocusTimerRef.current !== null) {
        dom.window.clearTimeout(refocusTimerRef.current);
      }
    };
  }, [dom]);

  const title = selection.note ? "Edit note" : "Add note";
  return (
    <section
      ref={surfaceRef}
      className="ml-note-editor"
      style={position.style}
      data-placement={position.placement}
      data-instant={motion === "instant" ? "true" : "false"}
      data-marimo-lens-note-editor
      data-marimo-lens-selection-cluster={selection.id}
      data-marimo-lens-ui
      aria-label={`${title} for ${selection.label}, cell ${selection.outputCellId}`}
    >
      <header className="ml-note-editor__header">
        <span className="ml-note-editor__selection ml-code">{selection.label}</span>
        <span aria-hidden="true">·</span>
        <span className="ml-note-editor__target">
          Cell <span className="ml-code">{selection.outputCellId}</span>
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
            aria-keyshortcuts="Meta+Enter Control+Enter"
            title="Save note (Command/Ctrl+Enter)"
          >
            {saving ? "Saving…" : "Done"}
          </button>
        </span>
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
