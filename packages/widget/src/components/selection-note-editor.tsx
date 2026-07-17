import { AlertCircle, Camera, Clock3, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Selection } from "@/contracts";

import { anchorToViewport } from "@/capture/anchor";
import { getOutputCell } from "@/capture/output-root";
import { useViewportRevision } from "@/viewport";

type SelectionNoteEditorProps = {
  selection: Selection;
  note: string;
  saving: boolean;
  mutationPending: boolean;
  motion: "animate" | "instant";
  saveError?: string;
  capturingSnapshot: boolean;
  onSave: (note: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onRetrySnapshot?: () => void;
};

export function SelectionNoteEditor({
  selection,
  note: initialNote,
  saving,
  mutationPending,
  motion,
  saveError,
  capturingSnapshot,
  onSave,
  onCancel,
  onDelete,
  onRetrySnapshot,
}: SelectionNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState(initialNote);
  const headingId = useId();
  const errorId = useId();
  useViewportRevision();
  const position = editorPosition(selection);

  useEffect(() => {
    setNote(initialNote);
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.select();
  }, [initialNote, selection.id]);

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
            <span aria-hidden="true"> · </span>
            {selection.anchor.kind === "point" ? "Point" : "Region"}
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
        value={note}
        maxLength={4_000}
        rows={3}
        placeholder="Add context for this selection"
        disabled={mutationPending}
        aria-invalid={saveError ? "true" : undefined}
        aria-describedby={saveError ? errorId : undefined}
        onChange={(event) => setNote(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!mutationPending) onSave(note);
          }
        }}
      />

      <SnapshotEditorStatus
        selection={selection}
        capturing={capturingSnapshot}
        onRetry={onRetrySnapshot}
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
          onClick={() => onSave(note)}
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

function SnapshotEditorStatus({
  selection,
  capturing,
  onRetry,
}: {
  selection: Selection;
  capturing: boolean;
  onRetry?: () => void;
}) {
  const snapshot = selection.snapshot;
  const view = (() => {
    if (capturing) {
      return {
        status: "capturing",
        action: "Retry snapshot",
        content: (
          <>
            <LoaderCircle className="ml-spin" size={13} aria-hidden="true" /> Preparing snapshot…
          </>
        ),
      };
    }

    switch (snapshot.status) {
      case "outdated":
        return {
          status: "outdated",
          action: "Refresh snapshot",
          content: (
            <>
              <Clock3 size={13} aria-hidden="true" /> Snapshot outdated
            </>
          ),
        };
      case "pending":
        return {
          status: "capturing",
          action: "Retry snapshot",
          content: (
            <>
              <LoaderCircle className="ml-spin" size={13} aria-hidden="true" /> Preparing snapshot…
            </>
          ),
        };
      case "available":
        return {
          status: "ready",
          action: "Retry snapshot",
          content: (
            <>
              <Camera size={13} aria-hidden="true" /> Snapshot ready
            </>
          ),
        };
      case "failed":
        return {
          status: "failed",
          action: "Retry snapshot",
          content: (
            <>
              <AlertCircle size={13} aria-hidden="true" /> Snapshot unavailable. Text context is
              ready.
            </>
          ),
        };
      default: {
        const unreachable: never = snapshot;
        return unreachable;
      }
    }
  })();

  return (
    <div className="ml-note-editor__snapshot" data-status={view.status} aria-live="polite">
      <span>{view.content}</span>
      {!capturing && onRetry && (snapshot.status === "failed" || snapshot.status === "outdated") ? (
        <button type="button" onClick={onRetry}>
          <RefreshCw size={12} aria-hidden="true" /> {view.action}
        </button>
      ) : null}
    </div>
  );
}

function editorPosition(selection: Selection): {
  style: React.CSSProperties;
  placement: "above" | "below";
} {
  const output = getOutputCell(selection.outputCellId)?.element;
  if (!output || typeof window === "undefined") {
    return { style: { right: 16, bottom: 72 }, placement: "above" };
  }
  const anchor = anchorToViewport(output, selection.anchor);
  const anchorX = anchor.kind === "point" ? anchor.x : anchor.x + anchor.width / 2;
  const anchorY = anchor.kind === "point" ? anchor.y : anchor.y;
  const width = Math.min(352, window.innerWidth - 24);
  const left = clamp(anchorX - width / 2, 12, Math.max(12, window.innerWidth - width - 12));
  const placeBelow = anchorY < 300;
  return {
    style: placeBelow
      ? { left, top: clamp(anchorY + 18, 12, window.innerHeight - 280), width }
      : {
          left,
          bottom: Math.max(12, window.innerHeight - anchorY + 18),
          width,
        },
    placement: placeBelow ? "below" : "above",
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
