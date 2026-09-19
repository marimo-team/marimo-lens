import type { Selection } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { LoaderCircle, MessageSquare, Pencil, Trash2 } from "lucide-react";

import type { RevealMotion } from "@/selection/reveal";
import type { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";

import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { SnapshotPreviewButton } from "@/selection/components/selection-snapshot-preview";
import { selectionTitle } from "@/selection/selection-description";
import { buttonStyles, iconButtonStyles, ui } from "@/styles/primitives";
import { moveSelectionRowFocus } from "@/ui/focus";

import { selectionListStyles } from "./selection-list.styles";
import { selectionSummaryMarker } from "./selection-markers.stylex";
import { sheetStyles } from "./selection-sheet.styles";

type SelectionListProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  availableSelectionIds: ReadonlySet<string>;
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
  availableSelectionIds,
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
    return <p {...stylex.props(sheetStyles.empty)}>No open selections.</p>;
  }

  return (
    <>
      <ol {...stylex.props(selectionListStyles.items)}>
        {selections.map((selection) => {
          const current = selection.id === currentSelectionId;
          const busy = busySelectionIds.has(selection.id);
          const targetAvailable = availableSelectionIds.has(selection.id);
          const label = selection.description.label;
          return (
            <li
              key={selection.id}
              {...stylex.props(
                selectionListStyles.item,
                current && selectionListStyles.itemCurrent,
              )}
              data-current={current ? "true" : "false"}
              data-marimo-lens-selection-cluster={selection.id}
            >
              <button
                {...stylex.props(
                  ui.interactive,
                  selectionSummaryMarker,
                  selectionListStyles.summary,
                )}
                data-marimo-lens-selection-summary
                data-marimo-lens-selection-focus={selection.id}
                type="button"
                disabled={busy}
                onKeyDown={moveSelectionRowFocus}
                onClick={(event) =>
                  onActivate(selection, event.detail === 0 ? "instant" : "smooth")
                }
                aria-current={current ? "true" : undefined}
                aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}, ${selection.note || "no note added"}, ${label}${targetAvailable ? "" : ", target unavailable"}`}
              >
                <span
                  {...stylex.props(
                    ui.label,
                    ui.borderless,
                    selectionListStyles.label,
                    current && selectionListStyles.labelCurrent,
                  )}
                >
                  {selection.label}
                </span>
                <span {...stylex.props(selectionListStyles.details)}>
                  <span
                    {...stylex.props(
                      selectionListStyles.note,
                      !selection.note && selectionListStyles.noteEmpty,
                    )}
                    data-marimo-lens-selection-note
                    data-empty={selection.note ? undefined : "true"}
                  >
                    {selection.note || "No note added"}
                  </span>
                  <small
                    {...stylex.props(selectionListStyles.metadata)}
                    data-marimo-lens-selection-metadata
                    title={selectionTitle(selection)}
                  >
                    <span {...stylex.props(ui.mono)}>{label}</span>
                    <SelectionKindMark kind={selection.anchor.kind} />
                    {!targetAvailable ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span
                          {...stylex.props(selectionListStyles.availability)}
                          data-marimo-lens-target-unavailable
                        >
                          Target unavailable
                        </span>
                      </>
                    ) : null}
                  </small>
                </span>
              </button>
              <div {...stylex.props(selectionListStyles.actions)}>
                <SnapshotPreviewButton
                  key={snapshotKey(selection)}
                  selection={selection}
                  capturing={capturingSelectionIds.has(selection.id)}
                  variant="icon"
                  snapshotLoader={snapshotLoader}
                />
                <button
                  {...stylex.props(...iconButtonStyles)}
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
                  {...stylex.props(...iconButtonStyles, ui.danger)}
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
      <footer {...stylex.props(selectionListStyles.footer)}>
        <button
          {...stylex.props(...buttonStyles, ui.danger, selectionListStyles.clear)}
          type="button"
          disabled={clearing || busySelectionIds.size > 0}
          onClick={onClear}
        >
          {clearing ? (
            <LoaderCircle {...stylex.props(ui.spin)} size={14} aria-hidden="true" />
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
