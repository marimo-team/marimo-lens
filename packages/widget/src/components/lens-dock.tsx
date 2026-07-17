import { ChevronDown, List, MousePointer2 } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { Selection } from "@/contracts";
import type { SnapshotAsset } from "@/protocol";
import type { RevealMotion } from "@/reveal";

import { MarimoLogo } from "@/components/marimo-logo";
import { SelectionList } from "@/components/selection-list";

type LensDockProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  availableOutputCellIds: ReadonlySet<string>;
  armed: boolean;
  listOpen: boolean;
  clearPending: boolean;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  interactionLocked: boolean;
  resolutionReceipt?: ReactNode;
  onToggleArmed: () => void;
  onToggleList: () => void;
  onClearSelections: () => void;
  onActivateSelection: (selection: Selection, motion: RevealMotion) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDeleteSelection: (selection: Selection) => void;
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>;
};

export function LensDock({
  selections,
  currentSelectionId,
  availableOutputCellIds,
  armed,
  listOpen,
  clearPending,
  capturingSelectionIds,
  busySelectionIds,
  interactionLocked,
  resolutionReceipt,
  onToggleArmed,
  onToggleList,
  onClearSelections,
  onActivateSelection,
  onEditNote,
  onDeleteSelection,
  loadSnapshot,
}: LensDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(true);
  const hasSelections = selections.length > 0;
  const commandsDisabled = interactionLocked || armed;

  useLayoutEffect(() => {
    const selector = listOpen
      ? '[data-marimo-lens-selection-list] [aria-current="true"], [data-marimo-lens-selection-list] .ml-selection-list__summary'
      : null;
    if (selector) dockRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [listOpen]);

  const closeList = () => {
    onToggleList();
    window.requestAnimationFrame(() => listTriggerRef.current?.focus());
  };

  const collapse = () => {
    if (listOpen) onToggleList();
    if (armed) onToggleArmed();
    setExpanded(false);
    window.requestAnimationFrame(() => tabRef.current?.focus());
  };

  return (
    <aside
      ref={dockRef}
      className="ml-dock"
      data-expanded={expanded ? "true" : "false"}
      data-marimo-lens-dock
      data-marimo-lens-ui
      aria-label="Marimo Lens"
    >
      {expanded && listOpen ? (
        <SelectionList
          selections={selections}
          currentSelectionId={currentSelectionId}
          availableOutputCellIds={availableOutputCellIds}
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          clearing={clearPending}
          notice={resolutionReceipt}
          onClose={closeList}
          onActivate={onActivateSelection}
          onEditNote={onEditNote}
          onDelete={onDeleteSelection}
          onClear={onClearSelections}
          loadSnapshot={loadSnapshot}
        />
      ) : (
        resolutionReceipt
      )}

      {expanded ? (
        <div className="ml-dockbar" data-armed={armed ? "true" : "false"}>
          <button
            className="ml-dockbar__action ml-dockbar__select"
            type="button"
            aria-pressed={armed}
            data-ml-select
            disabled={interactionLocked}
            onClick={onToggleArmed}
            aria-label={armed ? "Cancel selection mode" : "Select an output"}
          >
            <MousePointer2 size={15} aria-hidden="true" />
            <span>{armed ? "Click or drag" : "Select"}</span>
            {armed ? <kbd>ESC</kbd> : null}
          </button>

          {hasSelections ? (
            <Fragment>
              <span className="ml-dockbar__separator" aria-hidden="true" />
              <button
                ref={listTriggerRef}
                className="ml-dockbar__action ml-dockbar__selections"
                type="button"
                data-ml-list
                disabled={commandsDisabled}
                onClick={onToggleList}
                aria-expanded={listOpen}
                aria-controls="marimo-lens-selection-list"
                aria-label={`Open ${selections.length} ${selections.length === 1 ? "selection" : "selections"}`}
                title="Selections"
              >
                <List size={15} aria-hidden="true" />
                <span className="ml-dockbar__count">{selections.length}</span>
              </button>
            </Fragment>
          ) : null}

          <span className="ml-dockbar__separator" aria-hidden="true" />
          <button
            className="ml-dockbar__action ml-dockbar__icon"
            type="button"
            onClick={collapse}
            aria-label="Collapse Lens"
            title="Collapse Lens"
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          ref={tabRef}
          className="ml-dock-tab"
          type="button"
          data-ml-dock-tab
          onClick={() => setExpanded(true)}
          aria-label={
            hasSelections
              ? `Open Lens, ${selections.length} ${selections.length === 1 ? "selection" : "selections"}`
              : "Open Lens"
          }
          title="Open Lens"
        >
          <MarimoLogo className="ml-dock-tab__logo" />
          {hasSelections ? (
            <span className="ml-dock-tab__badge" aria-hidden="true">
              {selections.length}
            </span>
          ) : null}
        </button>
      )}
    </aside>
  );
}
