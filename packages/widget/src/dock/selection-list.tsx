import type { Selection } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { LoaderCircle, MessageSquare, Pencil, Trash2 } from "lucide-react";

import { useLens } from "@/context/lens-context";
import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { SnapshotPreviewButton } from "@/selection/components/selection-snapshot-preview";
import { selectionTitle } from "@/selection/selection-description";
import { buttonStyles, iconButtonStyles, ui } from "@/styles/primitives";
import { moveSelectionRowFocus } from "@/ui/focus";

import { selectionSummaryMarker } from "../selection/components/selection-markers.stylex";
import { selectionListStyles } from "./selection-list.styles";

/** The open selections in the requests sheet, with their image, note, and remove actions. */
export function SelectionList() {
  const { state, actions, meta } = useLens();
  const { selections, currentSelectionId, availableSelectionIds, busySelectionIds } = state;
  const clearing = state.clearPending;
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
                current ? selectionListStyles.itemCurrent : selectionListStyles.itemNeutral,
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
                  actions.activateSelection(selection, event.detail === 0 ? "instant" : "smooth")
                }
                aria-current={current ? "true" : undefined}
                aria-label={`${current ? "Current selection" : "Activate selection"} ${selection.label}, ${selection.note || "no note added"}, ${label}${targetAvailable ? "" : ", target unavailable"}`}
              >
                <span
                  {...stylex.props(
                    ui.label,
                    ui.borderless,
                    current ? selectionListStyles.labelCurrent : selectionListStyles.labelNeutral,
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
                  capturing={selection.snapshot.status === "pending"}
                  variant="icon"
                  snapshotLoader={meta.snapshotLoader}
                />
                <button
                  {...stylex.props(...iconButtonStyles)}
                  type="button"
                  disabled={busy}
                  onClick={(event) =>
                    actions.editNote(selection, event.detail === 0 ? "instant" : "animate")
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
                  onClick={() => actions.deleteSelection(selection)}
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
          onClick={actions.clearSelections}
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
