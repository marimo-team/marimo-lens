import type { ReactNode } from "react";

import { LoaderCircle, MessageSquare, Pencil, Trash2, X } from "lucide-react";

import type { Selection } from "@/contracts";
import type { SnapshotAsset } from "@/protocol";
import type { RevealMotion } from "@/reveal";

import { SnapshotPreviewButton } from "@/components/selection-snapshot-preview";

type SelectionListProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  availableOutputCellIds: ReadonlySet<string>;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  clearing: boolean;
  notice?: ReactNode;
  onClose: () => void;
  onActivate: (selection: Selection, motion: RevealMotion) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDelete: (selection: Selection) => void;
  onClear: () => void;
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>;
};

export function SelectionList({
  selections,
  currentSelectionId,
  availableOutputCellIds,
  capturingSelectionIds,
  busySelectionIds,
  clearing,
  notice,
  onClose,
  onActivate,
  onEditNote,
  onDelete,
  onClear,
  loadSnapshot,
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

      {notice ? <div className="ml-selection-list__notice">{notice}</div> : null}

      <ol className="ml-selection-list__items">
        {selections.map((selection) => {
          const current = selection.id === currentSelectionId;
          const busy = busySelectionIds.has(selection.id);
          const outputAvailable = availableOutputCellIds.has(selection.outputCellId);
          const kind = selection.anchor.kind === "point" ? "Point" : "Region";
          return (
            <li
              key={selection.id}
              className="ml-selection-list__item"
              data-current={current ? "true" : "false"}
              data-marimo-lens-selection-cluster={selection.id}
            >
              <button
                className="ml-selection-list__summary"
                data-marimo-lens-selection-focus={selection.id}
                type="button"
                disabled={busy}
                onClick={(event) =>
                  onActivate(selection, event.detail === 0 ? "instant" : "smooth")
                }
                aria-current={current ? "true" : undefined}
                aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}, ${selection.note || `cell ${selection.outputCellId}`}${outputAvailable ? "" : ", Output unavailable"}`}
              >
                <span className="ml-label">{selection.label}</span>
                <span className="ml-selection-list__details">
                  <strong>{selection.note || `Cell ${selection.outputCellId}`}</strong>
                  <small>
                    {selection.note ? (
                      <>
                        Cell <span className="ml-code">{selection.outputCellId}</span>
                        <span aria-hidden="true"> · </span>
                      </>
                    ) : null}
                    {kind}
                    {!outputAvailable ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="ml-selection-list__availability">Output unavailable</span>
                      </>
                    ) : null}
                  </small>
                </span>
              </button>
              <div className="ml-selection-list__actions">
                <SnapshotPreviewButton
                  key={snapshotKey(selection)}
                  selection={selection}
                  capturing={capturingSelectionIds.has(selection.id)}
                  variant="icon"
                  loadSnapshot={loadSnapshot}
                />
                <button
                  className="ml-icon-button"
                  type="button"
                  disabled={busy}
                  onClick={(event) =>
                    onEditNote(selection, event.detail === 0 ? "instant" : "animate")
                  }
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
      <footer className="ml-selection-list__footer">
        <button
          className="ml-button ml-button--danger"
          type="button"
          disabled={clearing || busySelectionIds.size > 0}
          onClick={onClear}
        >
          {clearing ? (
            <LoaderCircle className="ml-spin" size={14} aria-hidden="true" />
          ) : (
            <Trash2 size={14} aria-hidden="true" />
          )}
          {clearing ? "Clearing…" : "Clear selections"}
        </button>
      </footer>
    </section>
  );
}

function snapshotKey(selection: Selection): string {
  const snapshot = selection.snapshot;
  return snapshot.status === "available" || snapshot.status === "outdated"
    ? `${snapshot.id}:${snapshot.sha256}`
    : `${selection.id}:${snapshot.status}`;
}
