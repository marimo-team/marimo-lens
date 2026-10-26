import type { AddressedSelection, Selection } from "@marimo-lens/protocol";

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
import { useOutputCapture } from "@/app/use-output-capture";
import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { useDocumentInteractions } from "@/selection/document-interactions";
import { revealSelection } from "@/selection/reveal";
import { useSelectionActions } from "@/selection/selection-actions";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import { INITIAL_UI_STATE, uiReducer } from "@/selection/state";
import { useAvailableSelectionIds } from "@/selection/target-availability";
import { useTargetAttention } from "@/transient/use-target-attention";

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
 * and receipt, published as the Lens context plus what the overlay layers
 * draw.
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
  const presentation = useTargetAttention(model.protocol, dom, model.state);
  useCloseSheetForTrail(presentation?.trail?.id, dispatch);
  const receipt = useResolutionReceipt({
    state: model.state,
    protocol: model.protocol,
    dom,
    dispatch,
    invalidateSnapshotCapture: selectionActions.invalidateSnapshotCapture,
    attentionKind: presentation?.kind ?? null,
  });
  useDocumentInteractions({
    workflow: ui.workflow,
    uiRef,
    dispatch,
    dom,
    beginSelection: selectionActions.beginSelection,
    cancelAdjustment: adjustment.cancelAdjustment,
  });

  const history = model.state.history;
  const sheet = sheetView(ui, open.selections.length, history.length);
  const note = noteInProgress(ui, open.selections);
  useSettleUi(ui, sheet, note !== null, dispatch);
  const meta = useLensMeta(model);
  const actions = useLensActions({
    dispatch,
    dom,
    selectionActions,
    receipt,
    // Opening the sheet with no open selection shows History.
    opensOnHistory: !ui.sheetOpen && open.selections.length === 0 && history.length > 0,
  });

  const armed = ui.workflow.mode === "armed" || ui.workflow.mode === "dragging";
  const noteOpen = note !== null;
  const { selections, currentSelectionId, availableSelectionIds, busySelectionIds } = open;
  const { open: sheetOpen, tab, focusedHistoryRevision } = sheet;
  // Keep the value stable across drags and other interaction-only renders, so
  // context consumers render when what they read changes.
  const state = useMemo<LensState>(
    () => ({
      selections,
      currentSelectionId,
      availableSelectionIds,
      busySelectionIds,
      history,
      armed,
      interactionLocked: ui.clearPending || ui.historyClearPending || noteOpen,
      clearPending: ui.clearPending,
      historyClearPending: ui.historyClearPending,
      sheet: { open: sheetOpen, tab, focusedHistoryRevision },
      receipt: receipt.receipt,
    }),
    [
      selections,
      currentSelectionId,
      availableSelectionIds,
      busySelectionIds,
      history,
      armed,
      ui.clearPending,
      ui.historyClearPending,
      noteOpen,
      sheetOpen,
      tab,
      focusedHistoryRevision,
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
    presentation,
    adjustment,
    selectionActions,
  };
}

/** A Trail takes over the dock, so starting one closes the requests sheet. */
function useCloseSheetForTrail(trailId: string | undefined, dispatch: Dispatch<UiAction>) {
  useEffect(() => {
    if (trailId) dispatch({ type: "setSheetOpen", open: false });
  }, [dispatch, trailId]);
}

/**
 * Settle the interaction state after selections or History change underneath
 * it. A note whose selection closed ends, a sheet with nothing left closes, and
 * a sheet that fell through to the other tab stays there.
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
  const snapshotLoader = useMemo(
    () => new SelectionSnapshotLoader((selectionId) => model.protocol.getSnapshot(selectionId)),
    [model.protocol],
  );
  useEffect(() => () => snapshotLoader.clear(), [snapshotLoader]);
  return useMemo(() => ({ snapshotLoader }), [snapshotLoader]);
}

function useLensActions({
  dispatch,
  dom,
  selectionActions,
  receipt,
  opensOnHistory,
}: {
  dispatch: Dispatch<UiAction>;
  dom: NotebookDomAdapter;
  selectionActions: SelectionActions;
  receipt: ReturnType<typeof useResolutionReceipt>;
  opensOnHistory: boolean;
}): LensActions {
  const { setInteraction } = receipt;
  const {
    activateSelection,
    openNote,
    deleteSelection,
    clearSelections,
    clearHistory,
    reopenSelection,
  } = selectionActions;
  return useMemo<LensActions>(
    () => ({
      toggleArmed: () => dispatch({ type: "toggleArm" }),
      toggleSheet: () => {
        if (opensOnHistory) dispatch({ type: "setSheetTab", tab: "history" });
        dispatch({ type: "toggleSheet" });
      },
      setSheetTab: (tab) => dispatch({ type: "setSheetTab", tab }),
      openResolution: (event) =>
        dispatch({ type: "openHistory", resolutionRevision: event.revision }),
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
      clearHistory,
      reopen: (receipt: AddressedSelection) => {
        if (dom.getTarget(receipt.target)) {
          reopenSelection(receipt);
        } else {
          dispatch({ type: "announce", message: "Target unavailable in this document." });
        }
      },
      setReceiptInteraction: setInteraction,
    }),
    [
      activateSelection,
      clearHistory,
      clearSelections,
      deleteSelection,
      dispatch,
      dom,
      openNote,
      opensOnHistory,
      reopenSelection,
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
