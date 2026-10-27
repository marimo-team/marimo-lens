import type { HistoryEntry, Selection } from "@marimo-lens/protocol";

import { captureOutputSnapshot } from "@marimo-lens/image-capture";
import { useEffect, useLayoutEffect, useMemo, useReducer, type Dispatch } from "react";

import type { LensActions, LensContextValue, LensSheet, LensState } from "@/context/lens-context";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { RevealMotion } from "@/selection/reveal";
import type { SelectionMotion, UiAction, UiState } from "@/selection/state";

import { useLensModel, type LensModel } from "@/anywidget/model";
import { useLatestCommitted } from "@/app/committed-ref";
import { useResolutionReceipt } from "@/app/resolution-receipt";
import { sheetView } from "@/app/sheet-view";
import { useAdjustmentSlot } from "@/app/use-adjustment-slot";
import { useHistoryRefresh } from "@/app/use-history-refresh";
import { useOutputCapture } from "@/app/use-output-capture";
import { historyKey, indexRecord } from "@/context/record-index";
import { reopenTarget } from "@/history/entries";
import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { useDocumentInteractions } from "@/selection/document-interactions";
import { revealSelection } from "@/selection/reveal";
import { useSelectionActions } from "@/selection/selection-actions";
import { INITIAL_UI_STATE, uiReducer } from "@/selection/state";
import { useAvailableSelectionIds } from "@/selection/target-availability";
import { useTargetAttention } from "@/transient/use-target-attention";
import { focusListTrigger } from "@/ui/focus";

export type LensDependencies = {
  captureOutputSnapshot: typeof captureOutputSnapshot;
  useLensModel: typeof useLensModel;
  useSelectionActions: typeof useSelectionActions;
};

export const defaultDependencies: LensDependencies = {
  captureOutputSnapshot,
  useLensModel,
  useSelectionActions,
};

type SelectionActions = ReturnType<typeof useSelectionActions>;

/**
 * Run one Lens view: its interaction state, selection actions, attention,
 * receipt, and record, published as the Lens context plus what the overlay
 * layers draw.
 */
export function useLensController(dependencies: LensDependencies) {
  const dom = useNotebookDom();
  const model = dependencies.useLensModel(dom.window);
  // Availability and capture settlement read targets in this render and its
  // effects, so the adapter takes the selector before they do.
  dom.setSelector(model.selector);
  useLayoutEffect(() => dom.publishSelector(), [dom, model.selector]);
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const uiRef = useLatestCommitted(ui);
  const stateRef = useLatestCommitted(model.state);
  const adjustment = useAdjustmentSlot();
  const open = useOpenSelections(model, ui);
  const selectionActions = dependencies.useSelectionActions({
    stateRef,
    dispatch,
    dom,
    protocol: model.protocol,
    selections: open.selections,
    availableSelectionIds: open.availableSelectionIds,
  });
  useOutputCapture(model.protocol, dom, dependencies.captureOutputSnapshot);
  const attention = useTargetAttention(model.protocol, dom, model.state);
  useCloseSheetForTrail(attention.presentation?.trail?.id, dispatch);
  const receipt = useResolutionReceipt({
    state: model.state,
    protocol: model.protocol,
    dom,
    invalidateSnapshotCapture: selectionActions.invalidateSnapshotCapture,
    attentionKind: attention.agentAttentionKind,
  });
  useDocumentInteractions({
    workflow: ui.workflow,
    uiRef,
    dispatch,
    dom,
    beginSelection: selectionActions.beginSelection,
    cancelAdjustment: adjustment.cancelAdjustment,
  });

  const record = useMemo(() => indexRecord(model.history), [model.history]);
  const sheet = sheetView(ui, open.selections.length + model.chats.length, model.history);
  const note = noteInProgress(ui, open.selections);
  useSettleUi(ui, sheet, note !== null, dispatch);
  // The note editor lists the requests that shaped its selection, so History
  // stays current while either shows it.
  useHistoryRefresh(
    model.protocol,
    dom,
    (sheet.open && sheet.tab === "history") || (note !== null && model.history !== null),
  );
  const meta = useLensMeta(model);
  const actions = useLensActions({
    dispatch,
    dom,
    selectionActions,
    revealCells: attention.revealCells,
    receipt,
  });

  const armed = ui.workflow.mode === "armed" || ui.workflow.mode === "dragging";
  const noteOpen = note !== null;
  const { selections, currentSelectionId, availableSelectionIds, busySelectionIds } = open;
  const { open: sheetOpen, tab, focusedHistoryKey, shapedOnly } = sheet;
  // Keep the value stable across drags and other interaction-only renders, so
  // context consumers render when what they read changes.
  const state = useMemo<LensState>(
    () => ({
      selections,
      currentSelectionId,
      availableSelectionIds,
      busySelectionIds,
      chats: model.chats,
      history: model.history,
      record,
      armed,
      interactionLocked: ui.clearPending || noteOpen,
      clearPending: ui.clearPending,
      sheet: { open: sheetOpen, tab, focusedHistoryKey, shapedOnly },
      receipt: receipt.receipt,
    }),
    [
      selections,
      currentSelectionId,
      availableSelectionIds,
      busySelectionIds,
      model.chats,
      model.history,
      record,
      armed,
      ui.clearPending,
      noteOpen,
      sheetOpen,
      tab,
      focusedHistoryKey,
      shapedOnly,
      receipt.receipt,
    ],
  );
  const context = useMemo<LensContextValue>(
    () => ({ state, actions, meta }),
    [state, actions, meta],
  );

  return {
    context,
    css: model.css,
    ui,
    dispatch,
    dom,
    note,
    attention,
    adjustment,
    selectionActions,
    announcedReceipt: receipt.announced,
  };
}

/** A Trail takes over the dock, so starting one closes the requests sheet. */
function useCloseSheetForTrail(trailId: string | undefined, dispatch: Dispatch<UiAction>) {
  useEffect(() => {
    if (trailId) dispatch({ type: "setSheetOpen", open: false });
  }, [dispatch, trailId]);
}

/**
 * Settle the interaction state after requests or History change underneath it.
 * A note whose selection closed ends, a sheet with nothing left closes, and a
 * sheet that fell through to the other tab stays there when requests arrive.
 */
function useSettleUi(
  ui: UiState,
  sheet: LensSheet,
  noteOpen: boolean,
  dispatch: Dispatch<UiAction>,
) {
  const noteGone = ui.workflow.mode === "editingNote" && !noteOpen;
  const emptied = ui.sheetOpen && !sheet.open;
  const fellThrough = sheet.open && sheet.tab !== ui.sheetTab;
  useEffect(() => {
    if (noteGone) dispatch({ type: "closeNote" });
  }, [dispatch, noteGone]);
  useEffect(() => {
    if (emptied) dispatch({ type: "setSheetOpen", open: false });
  }, [dispatch, emptied]);
  useEffect(() => {
    if (fellThrough) dispatch({ type: "sheetFellThrough", tab: sheet.tab });
  }, [dispatch, fellThrough, sheet.tab]);
}

/** The open selections as this view shows them, with selections still being committed. */
function useOpenSelections(model: LensModel, ui: UiState) {
  const selections = useMemo(
    () => mergeSelections(model.state.selections, ui.pendingSelections),
    [model.state.selections, ui.pendingSelections],
  );
  const availableSelectionIds = useAvailableSelectionIds(selections);
  return {
    selections,
    currentSelectionId: ui.optimisticCurrentSelectionId ?? model.state.currentSelectionId,
    availableSelectionIds,
    busySelectionIds: ui.busySelectionIds,
  };
}

/** The note being written, while its selection is still open. */
function noteInProgress(ui: UiState, selections: readonly Selection[]) {
  const workflow = ui.workflow;
  if (workflow.mode !== "editingNote") return null;
  const selection = selections.find(({ id }) => id === workflow.selectionId);
  return selection ? { selection, motion: workflow.motion, error: workflow.error } : null;
}

function useLensMeta(model: LensModel): LensContextValue["meta"] {
  return useMemo(
    () => ({
      loadSnapshot: (selectionId: string) => model.protocol.getSnapshot(selectionId),
      loadHistoryImage: (sha256: string) => model.protocol.getHistoryImage(sha256),
    }),
    [model.protocol],
  );
}

function useLensActions({
  dispatch,
  dom,
  selectionActions,
  revealCells,
  receipt,
}: {
  dispatch: Dispatch<UiAction>;
  dom: NotebookDomAdapter;
  selectionActions: SelectionActions;
  revealCells: (entry: HistoryEntry) => void;
  receipt: ReturnType<typeof useResolutionReceipt>;
}): LensActions {
  const { setInteraction, dismiss } = receipt;
  const { activateSelection, openNote, deleteSelection, clearSelections, reopenSelection } =
    selectionActions;
  return useMemo<LensActions>(
    () => ({
      toggleArmed: () => dispatch({ type: "toggleArm" }),
      toggleSheet: () => dispatch({ type: "toggleSheet" }),
      setSheetTab: (tab) => dispatch({ type: "setSheetTab", tab }),
      setShapedOnly: (enabled) => dispatch({ type: "setShapedOnly", enabled }),
      openResolution: (event) =>
        dispatch({
          type: "openHistory",
          key: historyKey(event.payload.selections[0]!.selectionId, event.payload.resolvedAt),
        }),
      activateSelection: (selection: Selection, motion: RevealMotion) => {
        if (dom.getTarget(selection.target)) {
          revealSelection(dom, selection, motion);
        } else {
          dispatch({ type: "announce", message: "Target unavailable." });
        }
        activateSelection(selection.id);
      },
      editNote: (selection: Selection, motion: SelectionMotion) => openNote(selection.id, motion),
      deleteSelection,
      clearSelections,
      reopen: (entry) => {
        const target = reopenTarget(entry, dom.document);
        if (target && dom.getTarget(target)) {
          reopenSelection(entry);
        } else {
          dispatch({ type: "announce", message: "Target unavailable in this document." });
        }
      },
      revealCells: (entry) => {
        dispatch({ type: "setSheetOpen", open: false });
        revealCells(entry);
        focusListTrigger(dom);
      },
      dismissReceipt: dismiss,
      setReceiptInteraction: setInteraction,
    }),
    [
      activateSelection,
      clearSelections,
      deleteSelection,
      dismiss,
      dispatch,
      dom,
      openNote,
      reopenSelection,
      revealCells,
      setInteraction,
    ],
  );
}

function mergeSelections(stored: Selection[], pending: Selection[]): Selection[] {
  const merged = new Map(stored.map((selection) => [selection.id, selection]));
  for (const selection of pending) {
    if (!merged.has(selection.id)) merged.set(selection.id, selection);
  }
  return [...merged.values()];
}
