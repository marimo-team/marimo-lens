import {
  AlertCircle,
  Aperture,
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  FileText,
  Files,
  List,
  LoaderCircle,
  MousePointer2,
  Trash2,
} from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import type { ContextExportFormat, Selection } from "@/contracts";
import type { SnapshotAsset } from "@/protocol";
import type { RevealMotion } from "@/reveal";
import type { ExportState } from "@/state";

import { SelectionList } from "@/components/selection-list";

type LensDockProps = {
  selections: Selection[];
  currentSelectionId: string | null;
  armed: boolean;
  listOpen: boolean;
  menuOpen: boolean;
  exportState: ExportState;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  interactionLocked: boolean;
  onToggleArmed: () => void;
  onToggleList: () => void;
  onToggleMenu: () => void;
  onCopyContext: (format: ContextExportFormat) => void;
  onClearSelections: () => void;
  onActivateSelection: (selection: Selection, motion: RevealMotion) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDeleteSelection: (selection: Selection) => void;
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>;
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
  onToggleArmed,
  onToggleList,
  onToggleMenu,
  onCopyContext,
  onClearSelections,
  onActivateSelection,
  onEditNote,
  onDeleteSelection,
  loadSnapshot,
}: LensDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(true);
  const hasSelections = selections.length > 0;
  const commandsDisabled = interactionLocked || armed;

  useLayoutEffect(() => {
    const selector = listOpen
      ? '[data-marimo-lens-selection-list] [aria-current="true"], [data-marimo-lens-selection-list] .ml-selection-list__summary'
      : menuOpen
        ? "[data-marimo-lens-menu] button:not(:disabled)"
        : null;
    if (selector) dockRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [listOpen, menuOpen]);

  const closeList = () => {
    onToggleList();
    window.requestAnimationFrame(() => listTriggerRef.current?.focus());
  };

  const closeMenu = () => {
    onToggleMenu();
    window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
  };

  const collapse = () => {
    if (listOpen) onToggleList();
    if (menuOpen) onToggleMenu();
    if (armed) onToggleArmed();
    setExpanded(false);
    window.requestAnimationFrame(() => tabRef.current?.focus());
  };

  const runMenuExport = (format: ContextExportFormat) => {
    onCopyContext(format);
    closeMenu();
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
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          onClose={closeList}
          onActivate={onActivateSelection}
          onEditNote={onEditNote}
          onDelete={onDeleteSelection}
          loadSnapshot={loadSnapshot}
        />
      ) : null}

      {expanded && menuOpen ? (
        <div
          id="marimo-lens-menu"
          className="ml-menu"
          data-marimo-lens-menu
          data-marimo-lens-ui
          role="menu"
          aria-label="Lens actions"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!hasSelections || exportState.status === "exporting"}
            onClick={() => runMenuExport("references")}
          >
            <Files size={14} aria-hidden="true" /> Copy all references
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasSelections || exportState.status === "exporting"}
            onClick={() => runMenuExport("text")}
          >
            <FileText size={14} aria-hidden="true" /> Copy standalone text
          </button>
          <hr className="ml-menu__separator" />
          <button
            className="ml-menu__danger"
            type="button"
            role="menuitem"
            disabled={!hasSelections || busySelectionIds.size > 0 || interactionLocked}
            onClick={onClearSelections}
          >
            <Trash2 size={14} aria-hidden="true" /> Clear selections
          </button>
        </div>
      ) : null}

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
              <button
                className="ml-dockbar__action ml-dockbar__copy"
                type="button"
                disabled={
                  commandsDisabled || !currentSelectionId || exportState.status === "exporting"
                }
                onClick={() => onCopyContext("current")}
                title={
                  exportState.status === "error" ? exportState.message : "Copy current reference"
                }
              >
                <ContextExportIcon state={exportState} />
                <span>{contextExportLabel(exportState)}</span>
              </button>
              <button
                ref={menuTriggerRef}
                className="ml-dockbar__action ml-dockbar__icon"
                type="button"
                data-ml-menu
                disabled={commandsDisabled}
                onClick={onToggleMenu}
                aria-label="More Lens actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="marimo-lens-menu"
                title="More actions"
              >
                <Ellipsis size={16} aria-hidden="true" />
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
          onClick={() => setExpanded(true)}
          aria-label="Open Lens"
          title="Open Lens"
        >
          <Aperture size={17} aria-hidden="true" />
          {hasSelections ? <span>{selections.length}</span> : null}
        </button>
      )}
    </aside>
  );
}

function ContextExportIcon({ state }: { state: ExportState }) {
  if (state.status === "exporting") {
    return <LoaderCircle className="ml-spin" size={14} aria-hidden="true" />;
  }
  if (state.status === "success") return <Check size={14} aria-hidden="true" />;
  if (state.status === "error") return <AlertCircle size={14} aria-hidden="true" />;
  return <Copy size={14} aria-hidden="true" />;
}

function contextExportLabel(state: ExportState): string {
  if (state.status === "exporting") return "Copying…";
  if (state.status === "success") return "Copied";
  if (state.status === "error") return "Retry";
  return "Copy";
}
