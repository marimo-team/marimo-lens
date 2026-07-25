import type { Selection } from "@marimo-lens/protocol";

import { LoaderCircle, MessageSquare, Pencil, Trash2 } from "lucide-react";

import type { RevealMotion } from "@/selection/reveal";
import type { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";

import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { SnapshotPreviewButton } from "@/selection/components/selection-snapshot-preview";

type SelectionListProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  availableOutputCellIds: ReadonlySet<string>;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  clearing: boolean;
  onActivate: (selection: Selection, motion: RevealMotion) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDelete: (selection: Selection) => void;
  onClear: () => void;
  snapshotLoader: SelectionSnapshotLoader;
};

export function SelectionList({
  selections,
  currentSelectionId,
  availableOutputCellIds,
  capturingSelectionIds,
  busySelectionIds,
  clearing,
  onActivate,
  onEditNote,
  onDelete,
  onClear,
  snapshotLoader,
}: SelectionListProps) {
  if (selections.length === 0) {
    return <p className="ml-selection-sheet__empty">No open selections.</p>;
  }

  return (
    <>
      <ol className="ml-selection-list__items">
        {selections.map((selection) => {
          const current = selection.id === currentSelectionId;
          const busy = busySelectionIds.has(selection.id);
          const outputAvailable = availableOutputCellIds.has(selection.outputCellId);
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
                aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}, ${selection.note || "no note added"}, cell ${selection.outputCellId}${outputAvailable ? "" : ", Output unavailable"}`}
              >
                <span className="ml-label">{selection.label}</span>
                <span className="ml-selection-list__details">
                  <span
                    className="ml-selection-list__note"
                    data-empty={selection.note ? undefined : "true"}
                  >
                    {selection.note || "No note added"}
                  </span>
                  <small>
                    Cell <span className="ml-code">{selection.outputCellId}</span>
                    <SelectionKindMark kind={selection.anchor.kind} />
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
                  snapshotLoader={snapshotLoader}
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
    </>
  );
}

function snapshotKey(selection: Selection): string {
  const snapshot = selection.snapshot;
  return snapshot.status === "available" || snapshot.status === "outdated"
    ? `${snapshot.id}:${snapshot.sha256}`
    : `${selection.id}:${snapshot.status}`;
}
