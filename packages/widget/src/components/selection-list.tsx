import {
  AlertCircle,
  Camera,
  Check,
  Clock3,
  Copy,
  Ellipsis,
  LoaderCircle,
  MessageSquare,
  MousePointer2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import type { Selection } from "@/contracts";

export type ContextExportView =
  | { status: "idle" }
  | { status: "exporting" }
  | { status: "success" }
  | { status: "error"; message: string };

type SelectionListProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  exportState: ContextExportView;
  onClose: () => void;
  onSelectMore: () => void;
  onCopyContext: () => void;
  onOpenMenu: () => void;
  onActivate: (selection: Selection) => void;
  onEditNote: (selection: Selection) => void;
  onDelete: (selection: Selection) => void;
};

export function SelectionList({
  selections,
  currentSelectionId,
  capturingSelectionIds,
  busySelectionIds,
  exportState,
  onClose,
  onSelectMore,
  onCopyContext,
  onOpenMenu,
  onActivate,
  onEditNote,
  onDelete,
}: SelectionListProps) {
  return (
    <section
      id="marimo-lens-selection-list"
      className="ml-sheet ml-selection-list"
      data-marimo-lens-selection-list
      data-marimo-lens-ui
      aria-labelledby="marimo-lens-selection-list-title"
    >
      <header className="ml-sheet__header">
        <div className="ml-sheet__identity">
          <h2 id="marimo-lens-selection-list-title">Selections</h2>
          <span className="ml-count-badge" aria-hidden="true">
            {selections.length}
          </span>
        </div>
        <button
          className="ml-icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close selections"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <ol className="ml-selection-list__items">
        {selections.map((selection) => {
          const current = selection.id === currentSelectionId;
          const busy = busySelectionIds.has(selection.id);
          return (
            <li
              key={selection.id}
              className="ml-selection-list__item"
              data-current={current ? "true" : "false"}
            >
              <button
                className="ml-selection-list__summary"
                type="button"
                disabled={busy}
                onFocus={() => onActivate(selection)}
                onClick={(event) => {
                  if (document.activeElement !== event.currentTarget) onActivate(selection);
                }}
                aria-current={current ? "true" : undefined}
                aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}, ${selection.note || "selected output"}, cell ${selection.outputCellId}`}
              >
                <span className="ml-label">{selection.label}</span>
                <span className="ml-selection-list__copy">
                  <strong>{selection.note || "Selected output"}</strong>
                  <small>
                    <span className="ml-code">{selection.outputCellId}</span>
                    <span aria-hidden="true"> · </span>
                    {selection.anchor.kind === "point" ? "Point" : "Region"}
                  </small>
                  <SnapshotStatus
                    selection={selection}
                    capturing={capturingSelectionIds.has(selection.id)}
                  />
                </span>
                {current ? <span className="ml-current-badge">Current</span> : null}
              </button>
              <div className="ml-selection-list__actions">
                <button
                  className="ml-icon-button"
                  type="button"
                  disabled={busy}
                  onClick={() => onEditNote(selection)}
                  aria-label={`${selection.note ? "Edit" : "Add"} note for ${selection.label}`}
                  title={selection.note ? "Edit note" : "Add note"}
                >
                  {selection.note ? (
                    <Pencil size={15} aria-hidden="true" />
                  ) : (
                    <MessageSquare size={15} aria-hidden="true" />
                  )}
                </button>
                <button
                  className="ml-icon-button ml-icon-button--danger"
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(selection)}
                  aria-label={`Remove selection ${selection.label}`}
                  title="Remove selection"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="ml-sheet__footer">
        <div className="ml-sheet__footer-actions">
          <button className="ml-button ml-button--primary" type="button" onClick={onSelectMore}>
            <MousePointer2 size={14} aria-hidden="true" /> Select more
          </button>
          <button
            className="ml-button ml-button--secondary ml-copy-button"
            type="button"
            disabled={exportState.status === "exporting"}
            onClick={onCopyContext}
            title={exportState.status === "error" ? exportState.message : undefined}
          >
            <ContextExportIcon state={exportState} />
            {contextExportLabel(exportState)}
          </button>
        </div>
        <button
          className="ml-icon-button"
          type="button"
          data-ml-menu
          onClick={onOpenMenu}
          aria-label="More selection actions"
          aria-haspopup="menu"
          aria-controls="marimo-lens-menu"
        >
          <Ellipsis size={17} aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}

function SnapshotStatus({ selection, capturing }: { selection: Selection; capturing: boolean }) {
  if (capturing) {
    return (
      <span className="ml-snapshot-status" data-status="capturing">
        <LoaderCircle className="ml-spin" size={12} aria-hidden="true" /> Preparing snapshot…
      </span>
    );
  }

  const snapshot = selection.snapshot;
  switch (snapshot.status) {
    case "outdated":
      return (
        <span className="ml-snapshot-status" data-status="outdated">
          <Clock3 size={12} aria-hidden="true" /> Snapshot outdated
        </span>
      );
    case "pending":
      return (
        <span className="ml-snapshot-status" data-status="capturing">
          <LoaderCircle className="ml-spin" size={12} aria-hidden="true" /> Preparing snapshot…
        </span>
      );
    case "available":
      return (
        <span className="ml-snapshot-status" data-status="ready">
          <Camera size={12} aria-hidden="true" /> Snapshot ready
        </span>
      );
    case "failed":
      return (
        <span className="ml-snapshot-status" data-status="failed">
          <AlertCircle size={12} aria-hidden="true" /> Snapshot unavailable
        </span>
      );
    default: {
      const unreachable: never = snapshot;
      return unreachable;
    }
  }
}

function ContextExportIcon({ state }: { state: ContextExportView }) {
  if (state.status === "exporting") {
    return <LoaderCircle className="ml-spin" size={14} aria-hidden="true" />;
  }
  if (state.status === "success") return <Check size={14} aria-hidden="true" />;
  if (state.status === "error") return <AlertCircle size={14} aria-hidden="true" />;
  return <Copy size={14} aria-hidden="true" />;
}

function contextExportLabel(state: ContextExportView): string {
  if (state.status === "exporting") return "Preparing context…";
  if (state.status === "success") return "Context copied";
  if (state.status === "error") return "Copy failed";
  return "Copy context";
}
