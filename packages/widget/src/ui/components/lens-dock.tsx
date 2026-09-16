import type {
  AddressedSelection,
  Selection,
  SelectionResolvedEvent,
  TargetSelector,
} from "@marimo-lens/protocol";

import { ChevronDown, GripVertical, List, MousePointer2 } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { RevealMotion } from "@/selection/reveal";
import type { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import type { SelectionSheetTab } from "@/selection/state";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { SelectionSheet } from "@/selection/components/selection-sheet";
import { ResolutionReceipt } from "@/transient/resolution-receipt";
import { LensLogo } from "@/ui/components/lens-logo";
import { useDockMotion } from "@/ui/use-dock-motion";
import { useDockPosition } from "@/ui/use-dock-position";

const LENS_SELECTION_SHORTCUT = "Alt+L";
const LENS_SELECTION_SHORTCUT_LABEL = "Option/Alt+L";

type LensDockProps = {
  selections: Selection[];
  history: AddressedSelection[];
  currentSelectionId: string | null;
  availableSelectionIds: ReadonlySet<string>;
  selector: TargetSelector;
  armed: boolean;
  listOpen: boolean;
  sheetTab: SelectionSheetTab;
  focusedHistoryRevision: number | null;
  clearPending: boolean;
  historyClearPending: boolean;
  capturingSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  interactionLocked: boolean;
  resolutionReceipt?: SelectionResolvedEvent | null;
  targetAttentionFallback?: ReactNode;
  onToggleArmed: () => void;
  onToggleList: () => void;
  onSheetTabChange: (tab: SelectionSheetTab) => void;
  onOpenHistory: (event: SelectionResolvedEvent) => void;
  onResolutionReceiptInteractionChange?: (event: SelectionResolvedEvent, active: boolean) => void;
  onClearSelections: () => void;
  onClearHistory: () => void;
  onReopenSelection: (receipt: AddressedSelection) => void;
  onActivateSelection: (selection: Selection, motion: RevealMotion) => void;
  onEditNote: (selection: Selection, motion: "animate" | "instant") => void;
  onDeleteSelection: (selection: Selection) => void;
  snapshotLoader: SelectionSnapshotLoader;
};

type SheetFocus = {
  open: boolean;
  historyRevision: number | null;
};

export function LensDock({
  selections,
  history,
  currentSelectionId,
  availableSelectionIds,
  selector,
  armed,
  listOpen,
  sheetTab,
  focusedHistoryRevision,
  clearPending,
  historyClearPending,
  capturingSelectionIds,
  busySelectionIds,
  interactionLocked,
  resolutionReceipt,
  targetAttentionFallback,
  onToggleArmed,
  onToggleList,
  onSheetTabChange,
  onOpenHistory,
  onResolutionReceiptInteractionChange,
  onClearSelections,
  onClearHistory,
  onReopenSelection,
  onActivateSelection,
  onEditNote,
  onDeleteSelection,
  snapshotLoader,
}: LensDockProps) {
  const dom = useNotebookDom();
  const dockRef = useRef<HTMLElement>(null);
  useDockPosition(dockRef);
  useDockMotion(dockRef);
  const selectRef = useRef<HTMLButtonElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const listTriggerRef = useRef<HTMLButtonElement>(null);
  const sheetFocusRef = useRef<SheetFocus>({ open: false, historyRevision: null });
  const [expanded, setExpanded] = useState(true);
  const hasSelectionSurface = selections.length > 0 || history.length > 0;
  const commandsDisabled = interactionLocked || armed;

  useLayoutEffect(() => {
    const open = expanded && listOpen;
    const previous = sheetFocusRef.current;
    const shouldFocus =
      open &&
      (!previous.open ||
        (focusedHistoryRevision !== null && focusedHistoryRevision !== previous.historyRevision));
    sheetFocusRef.current = { open, historyRevision: focusedHistoryRevision };
    if (!shouldFocus) return;
    const dock = dockRef.current;
    const target =
      sheetTab === "history"
        ? focusedHistoryRevision === null
          ? dock?.querySelector<HTMLElement>("#marimo-lens-history-tab")
          : (dock?.querySelector<HTMLElement>(
              `[data-marimo-lens-history-revision="${focusedHistoryRevision}"] .ml-history-list__reopen`,
            ) ?? dock?.querySelector<HTMLElement>("#marimo-lens-history-tab"))
        : (dock?.querySelector<HTMLElement>(
            '[data-marimo-lens-selection-list] [aria-current="true"]',
          ) ??
          dock?.querySelector<HTMLElement>(
            "[data-marimo-lens-selection-list] .ml-selection-list__summary",
          ) ??
          dock?.querySelector<HTMLElement>("#marimo-lens-open-tab"));
    target?.focus();
  }, [expanded, focusedHistoryRevision, listOpen, sheetTab]);

  const closeList = () => {
    onToggleList();
    dom.window.requestAnimationFrame(() => listTriggerRef.current?.focus());
  };

  const collapse = useCallback(() => {
    if (listOpen) onToggleList();
    if (armed) onToggleArmed();
    setExpanded(false);
    dom.window.requestAnimationFrame(() => tabRef.current?.focus());
  }, [armed, dom, listOpen, onToggleArmed, onToggleList]);

  const expand = useCallback(() => {
    setExpanded(true);
    dom.window.requestAnimationFrame(() => selectRef.current?.focus());
  }, [dom]);

  const enterSelectionMode = useCallback(() => {
    setExpanded(true);
    if (!armed && !interactionLocked) onToggleArmed();
    dom.window.requestAnimationFrame(() => selectRef.current?.focus());
  }, [armed, dom, interactionLocked, onToggleArmed]);

  const enterSelection = useEffectEvent((event: KeyboardEvent) => {
    if (!isLensSelectionShortcut(event) || interactionLocked) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) enterSelectionMode();
  });
  useEffect(() => {
    return dom.observeInteractionSurfaces(
      {
        includeTargetFrames: true,
        lockSelectionGestures: false,
        targetRoots: () => dom.listTargets(selector).map(({ element }) => element),
      },
      (surface) => {
        surface.document.addEventListener("keydown", enterSelection, true);
        return () => surface.document.removeEventListener("keydown", enterSelection, true);
      },
    );
  }, [dom, selector]);

  const openHistory = (event: SelectionResolvedEvent) => {
    setExpanded(true);
    onOpenHistory(event);
  };

  return (
    <aside
      ref={dockRef}
      className="ml-dock"
      data-expanded={expanded ? "true" : "false"}
      data-marimo-lens-dock
      data-marimo-lens-ui
      aria-label="marimo-lens"
    >
      <span id="ml-dock-move-help" hidden>
        Drag or use arrow keys to move. Shift moves faster. Home resets position.
      </span>
      {expanded && listOpen ? (
        <div className="ml-sheet-stack">
          <SelectionSheet
            activeTab={sheetTab}
            selections={selections}
            history={history}
            currentSelectionId={currentSelectionId}
            availableSelectionIds={availableSelectionIds}
            capturingSelectionIds={capturingSelectionIds}
            busySelectionIds={busySelectionIds}
            clearingSelections={clearPending}
            clearingHistory={historyClearPending}
            notice={
              resolutionReceipt ? (
                <ResolutionReceipt
                  key={`${resolutionReceipt.revision}:${resolutionReceipt.payload.selections
                    .map(({ selectionId }) => selectionId)
                    .join(",")}`}
                  event={resolutionReceipt}
                  onOpenHistory={openHistory}
                  onInteractionChange={onResolutionReceiptInteractionChange}
                />
              ) : null
            }
            onTabChange={onSheetTabChange}
            onClose={closeList}
            onActivate={onActivateSelection}
            onEditNote={onEditNote}
            onDelete={onDeleteSelection}
            onClearSelections={onClearSelections}
            onClearHistory={onClearHistory}
            onReopen={onReopenSelection}
            snapshotLoader={snapshotLoader}
          />
          {targetAttentionFallback}
        </div>
      ) : (
        <>
          {targetAttentionFallback ??
            (resolutionReceipt ? (
              <ResolutionReceipt
                event={resolutionReceipt}
                onOpenHistory={openHistory}
                onInteractionChange={onResolutionReceiptInteractionChange}
              />
            ) : null)}
        </>
      )}

      {expanded ? (
        <div className="ml-dockbar" data-armed={armed ? "true" : "false"}>
          <button
            className="ml-dockbar__action ml-dockbar__grip"
            type="button"
            data-ml-dock-drag
            aria-label="Move Lens"
            aria-describedby="ml-dock-move-help"
            title="Move Lens · Arrow keys to move · Home to reset"
          >
            <GripVertical size={14} aria-hidden="true" />
          </button>
          <button
            ref={selectRef}
            className="ml-dockbar__action ml-dockbar__select"
            type="button"
            aria-pressed={armed}
            aria-keyshortcuts={
              armed
                ? `${LENS_SELECTION_SHORTCUT} ArrowUp ArrowDown Enter Escape`
                : LENS_SELECTION_SHORTCUT
            }
            data-ml-select
            disabled={interactionLocked}
            onClick={onToggleArmed}
            aria-label={armed ? "Cancel selection mode" : "Select a target"}
            title={
              armed
                ? "Selection mode active (Escape to exit)"
                : `Select a target (${LENS_SELECTION_SHORTCUT_LABEL})`
            }
          >
            <MousePointer2 size={15} aria-hidden="true" />
            <span>{armed ? "Click or drag" : "Select"}</span>
            {armed ? <kbd>ESC</kbd> : null}
          </button>

          {hasSelectionSurface ? (
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
                aria-label={`Open selections, ${selections.length} open, ${history.length} in history`}
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
            data-ml-dock-toggle
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
          data-ml-dock-toggle
          data-ml-dock-drag
          aria-describedby="ml-dock-move-help"
          onClick={expand}
          aria-label={
            hasSelectionSurface
              ? `Open Lens, ${selections.length} open ${selections.length === 1 ? "selection" : "selections"}, ${history.length} in history`
              : "Open Lens"
          }
          title="Open Lens"
        >
          <LensLogo className="ml-dock-tab__logo" />
          {selections.length > 0 ? (
            <span className="ml-dock-tab__badge" aria-hidden="true">
              {selections.length}
            </span>
          ) : null}
        </button>
      )}
    </aside>
  );
}

function isLensSelectionShortcut(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.code === "KeyL"
  );
}
