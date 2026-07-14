import { Check, Focus, MousePointer2, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import type { Selection } from "@/contracts";

import { SelectionList, type ContextExportView } from "@/components/selection-list";

export type SelectionReceipt = { selection: Selection } | null;

type LensDockProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  armed: boolean;
  listOpen: boolean;
  menuOpen: boolean;
  exportState: ContextExportView;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  interactionLocked: boolean;
  selectionReceipt?: SelectionReceipt;
  onToggleArmed: () => void;
  onToggleList: () => void;
  onToggleMenu: () => void;
  onCopyContext: () => void;
  onClearSelections: () => void;
  onActivateSelection: (selection: Selection) => void;
  onEditNote: (selection: Selection) => void;
  onDeleteSelection: (selection: Selection) => void;
};

export function LensDock({
  selections,
  currentSelectionId,
  armed,
  listOpen,
  menuOpen,
  exportState,
  capturingSelectionIds,
  busySelectionIds,
  interactionLocked,
  selectionReceipt = null,
  onToggleArmed,
  onToggleList,
  onToggleMenu,
  onCopyContext,
  onClearSelections,
  onActivateSelection,
  onEditNote,
  onDeleteSelection,
}: LensDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const hasSelections = selections.length > 0;

  useLayoutEffect(() => {
    const selector = listOpen
      ? "[data-marimo-lens-selection-list] button:not(:disabled)"
      : menuOpen
        ? "[data-marimo-lens-menu] button:not(:disabled)"
        : null;
    if (selector) dockRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [listOpen, menuOpen]);

  const closeList = () => {
    onToggleList();
    window.requestAnimationFrame(() => listTriggerRef.current?.focus());
  };

  const beginSelecting = () => {
    if (listOpen) onToggleList();
    onToggleArmed();
  };

  return (
    <aside
      ref={dockRef}
      className="ml-dock"
      data-marimo-lens-dock
      data-marimo-lens-ui
      aria-label="Marimo Lens"
    >
      {listOpen ? (
        <SelectionList
          selections={selections}
          currentSelectionId={currentSelectionId}
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          exportState={exportState}
          onClose={closeList}
          onSelectMore={beginSelecting}
          onCopyContext={onCopyContext}
          onOpenMenu={onToggleMenu}
          onActivate={onActivateSelection}
          onEditNote={onEditNote}
          onDelete={onDeleteSelection}
        />
      ) : null}

      {menuOpen ? (
        <div
          id="marimo-lens-menu"
          className="ml-menu"
          data-marimo-lens-menu
          data-marimo-lens-ui
          role="menu"
          aria-label="Selection actions"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!hasSelections || busySelectionIds.size > 0 || interactionLocked}
            onClick={onClearSelections}
          >
            <Trash2 size={14} aria-hidden="true" /> Clear selections
          </button>
        </div>
      ) : null}

      {selectionReceipt && !listOpen && !armed ? (
        <div className="ml-selection-receipt" data-marimo-lens-selection-receipt>
          <output aria-live="polite" aria-atomic="true">
            <Check size={14} aria-hidden="true" /> {selectionReceipt.selection.label} selected
          </output>
          <button type="button" onClick={() => onEditNote(selectionReceipt.selection)}>
            Add note
          </button>
        </div>
      ) : null}

      <div
        className="ml-puck"
        data-empty={hasSelections ? "false" : "true"}
        data-armed={armed ? "true" : "false"}
      >
        <button
          className="ml-puck__select"
          type="button"
          aria-pressed={armed}
          data-ml-select
          disabled={interactionLocked}
          onClick={onToggleArmed}
          aria-label={armed ? "Cancel selection mode" : hasSelections ? "Select more" : "Select"}
        >
          {armed ? (
            <MousePointer2 className="ml-puck__armed-icon" size={15} aria-hidden="true" />
          ) : hasSelections ? (
            <Focus size={15} aria-hidden="true" />
          ) : (
            <MousePointer2 className="ml-puck__empty-icon" size={15} aria-hidden="true" />
          )}
          <span className="ml-puck__label">
            {armed ? "Click or drag" : hasSelections ? "Select more" : "Select"}
          </span>
          {armed ? <kbd>ESC</kbd> : null}
        </button>

        {hasSelections && !armed ? (
          <button
            ref={listTriggerRef}
            className="ml-puck__count"
            type="button"
            data-ml-list
            data-ml-menu
            disabled={interactionLocked}
            onClick={onToggleList}
            aria-expanded={listOpen}
            aria-controls="marimo-lens-selection-list"
            aria-label={`Open ${selections.length} ${selections.length === 1 ? "selection" : "selections"}`}
          >
            <span>{selections.length}</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
