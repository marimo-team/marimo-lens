import type { AddressedSelection, Selection } from "@marimo-lens/protocol";
import type { KeyboardEvent, ReactNode } from "react";

import { LoaderCircle, MoreHorizontal, Trash2, X } from "lucide-react";

import type { RevealMotion } from "@/selection/reveal";
import type { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import type { SelectionSheetTab } from "@/selection/state";

import { HistoryList } from "@/selection/components/history-list";
import { SelectionList } from "@/selection/components/selection-list";

type SelectionSheetProps = {
  activeTab: SelectionSheetTab;
  selections: Selection[];
  history: AddressedSelection[];
  currentSelectionId: string | null;
  availableOutputCellIds: ReadonlySet<string>;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  clearingSelections: boolean;
  clearingHistory: boolean;
  notice?: ReactNode;
  onTabChange: (tab: SelectionSheetTab) => void;
  onClose: () => void;
  onActivate: (selection: Selection, motion: RevealMotion) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDelete: (selection: Selection) => void;
  onClearSelections: () => void;
  onClearHistory: () => void;
  onReopen: (receipt: AddressedSelection) => void;
  snapshotLoader: SelectionSnapshotLoader;
};

export function SelectionSheet({
  activeTab,
  selections,
  history,
  currentSelectionId,
  availableOutputCellIds,
  capturingSelectionIds,
  busySelectionIds,
  clearingSelections,
  clearingHistory,
  notice,
  onTabChange,
  onClose,
  onActivate,
  onEditNote,
  onDelete,
  onClearSelections,
  onClearHistory,
  onReopen,
  snapshotLoader,
}: SelectionSheetProps) {
  const changeTabFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextTab =
      event.key === "Home"
        ? "open"
        : event.key === "End"
          ? "history"
          : event.key === "ArrowLeft" || event.key === "ArrowRight"
            ? event.currentTarget.id === "marimo-lens-open-tab"
              ? "history"
              : "open"
            : null;
    if (!nextTab) return;
    event.preventDefault();
    if (
      (nextTab === "open" && selections.length === 0) ||
      (nextTab === "history" && history.length === 0)
    ) {
      return;
    }
    onTabChange(nextTab);
    event.currentTarget.ownerDocument.getElementById(`marimo-lens-${nextTab}-tab`)?.focus();
  };

  return (
    <section
      id="marimo-lens-selection-list"
      className="ml-sheet ml-selection-sheet"
      data-marimo-lens-selection-list
      data-marimo-lens-ui
      aria-labelledby="marimo-lens-selection-list-title"
    >
      <header className="ml-sheet__header">
        <div className="ml-sheet__identity">
          <h2 id="marimo-lens-selection-list-title">Selections</h2>
        </div>
        <div className="ml-sheet__actions">
          {history.length > 0 ? (
            <details className="ml-sheet-overflow">
              <summary className="ml-icon-button" aria-label="Selection options">
                <MoreHorizontal size={16} aria-hidden="true" />
              </summary>
              <div className="ml-sheet-overflow__menu">
                <button
                  className="ml-sheet-overflow__action ml-sheet-overflow__action--danger"
                  type="button"
                  disabled={clearingHistory || busySelectionIds.size > 0}
                  onClick={onClearHistory}
                >
                  {clearingHistory ? (
                    <LoaderCircle className="ml-spin" size={14} aria-hidden="true" />
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                  {clearingHistory ? "Clearing…" : "Clear history"}
                </button>
              </div>
            </details>
          ) : null}
          <button
            className="ml-icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close selections"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="ml-selection-sheet__tabs" role="tablist" aria-label="Selection status">
        <button
          id="marimo-lens-open-tab"
          className="ml-selection-sheet__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "open"}
          aria-controls="marimo-lens-open-panel"
          tabIndex={activeTab === "open" ? 0 : -1}
          disabled={selections.length === 0}
          onClick={() => onTabChange("open")}
          onKeyDown={changeTabFromKeyboard}
        >
          Open <span>{selections.length}</span>
        </button>
        <button
          id="marimo-lens-history-tab"
          className="ml-selection-sheet__tab"
          type="button"
          role="tab"
          aria-selected={activeTab === "history"}
          aria-controls="marimo-lens-history-panel"
          tabIndex={activeTab === "history" ? 0 : -1}
          disabled={history.length === 0}
          onClick={() => onTabChange("history")}
          onKeyDown={changeTabFromKeyboard}
        >
          History <span>{history.length}</span>
        </button>
      </div>

      {notice ? <div className="ml-selection-list__notice">{notice}</div> : null}

      <div
        id="marimo-lens-open-panel"
        className="ml-selection-sheet__panel"
        role="tabpanel"
        aria-labelledby="marimo-lens-open-tab"
        hidden={activeTab !== "open"}
      >
        <SelectionList
          selections={selections}
          currentSelectionId={currentSelectionId}
          availableOutputCellIds={availableOutputCellIds}
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          clearing={clearingSelections}
          onActivate={onActivate}
          onEditNote={onEditNote}
          onDelete={onDelete}
          onClear={onClearSelections}
          snapshotLoader={snapshotLoader}
        />
      </div>
      <div
        id="marimo-lens-history-panel"
        className="ml-selection-sheet__panel"
        role="tabpanel"
        aria-labelledby="marimo-lens-history-tab"
        hidden={activeTab !== "history"}
      >
        <HistoryList
          history={history}
          openSelectionIds={new Set(selections.map(({ id }) => id))}
          busySelectionIds={busySelectionIds}
          onReopen={onReopen}
        />
      </div>
    </section>
  );
}
