import type { Selection } from "@marimo-lens/protocol";

import { captureOutputSnapshot } from "@marimo-lens/image-capture";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { LensProtocolError, type LensProtocolClient } from "@/anywidget/client";
import { useLensModel } from "@/anywidget/model";
import { useLatestCommitted } from "@/app/committed-ref";
import { useResolutionReceipt } from "@/app/resolution-receipt";
import { useNotebookDom, type NotebookDomAdapter } from "@/notebook/notebook-dom";
import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";
import { SelectionOverlay, type AdjustmentCancel } from "@/selection/components/selection-overlay";
import { useDocumentInteractions } from "@/selection/document-interactions";
import { useAvailableOutputCellIds } from "@/selection/output-availability";
import { revealSelection } from "@/selection/reveal";
import { useSelectionActions } from "@/selection/selection-actions";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import { INITIAL_UI_STATE, locksCompetingInteractions, uiReducer } from "@/selection/state";
import {
  CellAttentionController,
  type CellAttentionPresentation,
} from "@/transient/cell-attention";
import {
  CellAttentionAnnouncement,
  CellAttentionFallback,
  CellAttentionIndicator,
  projectCellAttention,
} from "@/transient/cell-attention-indicator";
import { LensDock } from "@/ui/components/lens-dock";
import { LensPortal } from "@/ui/components/lens-portal";
import { LensStatus } from "@/ui/components/lens-status";
import { focusDock, focusSelectionOrDock } from "@/ui/focus";

export function MarimoLensContent() {
  const dom = useNotebookDom();
  const model = useLensModel(dom.window);
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const uiRef = useLatestCommitted(ui);
  const stateRef = useLatestCommitted(model.state);
  const canceledPointerIds = useRef(new Set<number>());
  const activeAdjustment = useRef<AdjustmentCancel | null>(null);

  const registerAdjustment = useCallback((cancel: AdjustmentCancel) => {
    activeAdjustment.current?.();
    activeAdjustment.current = cancel;
  }, []);
  const releaseAdjustment = useCallback((cancel: AdjustmentCancel) => {
    if (activeAdjustment.current === cancel) activeAdjustment.current = null;
  }, []);
  const cancelAdjustment = useCallback(() => {
    const cancel = activeAdjustment.current;
    if (!cancel) return false;
    activeAdjustment.current = null;
    cancel();
    return true;
  }, []);

  useEffect(
    () => () => {
      activeAdjustment.current?.();
      activeAdjustment.current = null;
    },
    [],
  );

  const actions = useSelectionActions({
    stateRef,
    dispatch,
    dom,
    protocol: model.protocol,
  });
  const { invalidateSnapshotCapture, settleUnavailableSnapshot } = actions;
  useOutputCapture(model.protocol, dom);
  const cellAttention = useCellAttention(model.protocol, dom);
  const [cellAttentionLabel, setCellAttentionLabel] = useState<{
    sequence: number;
    height: number;
    maxWidth: number;
  } | null>(null);
  const measureCellAttentionLabel = useCallback(
    (sequence: number, measurement: { height: number; maxWidth: number }) => {
      setCellAttentionLabel((current) =>
        current?.sequence === sequence &&
        current.height === measurement.height &&
        current.maxWidth === measurement.maxWidth
          ? current
          : { sequence, ...measurement },
      );
    },
    [],
  );
  const resolutionReceipt = useResolutionReceipt({
    state: model.state,
    protocol: model.protocol,
    dom,
    dispatch,
    invalidateSnapshotCapture,
    attentionKind: cellAttention?.kind ?? null,
  });
  const cellAttentionView = projectCellAttention(
    cellAttention,
    dom.window,
    cellAttentionLabel !== null && cellAttentionLabel.sequence === cellAttention?.sequence
      ? cellAttentionLabel
      : undefined,
  );
  const snapshotLoader = useMemo(
    () => new SelectionSnapshotLoader((selectionId) => model.protocol.getSnapshot(selectionId)),
    [model.protocol],
  );
  useEffect(() => () => snapshotLoader.clear(), [snapshotLoader]);

  useDocumentInteractions({
    workflow: ui.workflow,
    uiRef,
    dispatch,
    dom,
    beginSelection: actions.beginSelection,
    canceledPointerIds,
    cancelAdjustment,
  });

  const selections = useMemo(
    () =>
      mergeSelections(
        model.state.selections,
        ui.pendingSelections.map(({ selection }) => selection),
      ),
    [model.state.selections, ui.pendingSelections],
  );
  const currentSelectionId = ui.optimisticCurrentSelectionId ?? model.state.currentSelectionId;
  const availableOutputCellIds = useAvailableOutputCellIds(selections);
  const busySelectionIds = useMemo(() => new Set(ui.busySelectionIds), [ui.busySelectionIds]);
  const capturingSelectionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const selection of selections) {
      if (selection.snapshot.status === "pending") ids.add(selection.id);
    }
    return ids;
  }, [selections]);

  useEffect(() => {
    for (const selection of selections) {
      if (
        selection.snapshot.status === "pending" &&
        !availableOutputCellIds.has(selection.outputCellId)
      ) {
        settleUnavailableSnapshot(selection.id);
      }
    }
  }, [availableOutputCellIds, selections, settleUnavailableSnapshot]);

  const noteWorkflow = ui.workflow.mode === "editingNote" ? ui.workflow : null;
  const noteSelection = noteWorkflow
    ? (selections.find(({ id }) => id === noteWorkflow.selectionId) ?? null)
    : null;
  useEffect(() => {
    const workflow = ui.workflow;
    if (
      workflow.mode === "editingNote" &&
      !selections.some(({ id }) => id === workflow.selectionId)
    ) {
      dispatch({ type: "closeNote" });
    }
    if (ui.listOpen && selections.length === 0 && model.state.history.length === 0) {
      dispatch({ type: "setListOpen", open: false });
    } else if (
      ui.listOpen &&
      ui.sheetTab === "open" &&
      selections.length === 0 &&
      model.state.history.length > 0
    ) {
      dispatch({ type: "setSheetTab", tab: "history" });
    } else if (
      ui.listOpen &&
      ui.sheetTab === "history" &&
      model.state.history.length === 0 &&
      selections.length > 0
    ) {
      dispatch({ type: "setSheetTab", tab: "open" });
    }
  }, [model.state.history.length, selections, ui.listOpen, ui.sheetTab, ui.workflow]);

  const interactionLocked = locksCompetingInteractions(ui);

  return (
    <>
      <LensPortal css={model.css}>
        <LensDock
          selections={selections}
          history={model.state.history}
          currentSelectionId={currentSelectionId}
          availableOutputCellIds={availableOutputCellIds}
          armed={ui.workflow.mode === "armed" || ui.workflow.mode === "dragging"}
          listOpen={ui.listOpen}
          sheetTab={ui.sheetTab}
          focusedHistoryRevision={ui.focusedHistoryRevision}
          clearPending={ui.clearPending}
          historyClearPending={ui.historyClearPending}
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          interactionLocked={interactionLocked}
          resolutionReceipt={resolutionReceipt.receipt}
          onResolutionReceiptInteractionChange={resolutionReceipt.setInteraction}
          cellAttentionFallback={
            cellAttention && cellAttention.target === null ? (
              <CellAttentionFallback presentation={cellAttention} />
            ) : null
          }
          onToggleArmed={() =>
            dispatch(
              ui.workflow.mode === "armed" || ui.workflow.mode === "dragging"
                ? { type: "disarm" }
                : { type: "arm" },
            )
          }
          onToggleList={() => {
            if (!ui.listOpen && selections.length === 0 && model.state.history.length > 0) {
              dispatch({ type: "setSheetTab", tab: "history" });
            }
            dispatch({ type: "setListOpen", open: !ui.listOpen });
          }}
          onSheetTabChange={(tab) => dispatch({ type: "setSheetTab", tab })}
          onOpenHistory={(event) =>
            dispatch({
              type: "openHistory",
              resolutionRevision: event.revision,
            })
          }
          onClearSelections={actions.clearSelections}
          onClearHistory={actions.clearHistory}
          onReopenSelection={actions.reopenSelection}
          onActivateSelection={(selection, motion) => {
            if (dom.getOutputCell(selection.outputCellId)) {
              revealSelection(dom, selection, motion);
            } else {
              dispatch({ type: "announce", message: "Output unavailable." });
            }
            actions.activateSelection(selection.id);
          }}
          onEditNote={(selection, motion) => actions.openNote(selection.id, motion)}
          onDeleteSelection={actions.deleteSelection}
          snapshotLoader={snapshotLoader}
        />

        <SelectionOverlay
          selections={selections}
          currentSelectionId={currentSelectionId}
          availableOutputCellIds={availableOutputCellIds}
          workflow={ui.workflow}
          busySelectionIds={busySelectionIds}
          capturingSelectionIds={capturingSelectionIds}
          registerAdjustment={registerAdjustment}
          releaseAdjustment={releaseAdjustment}
          onActivate={(selection) => actions.activateSelection(selection.id)}
          onEditNote={(selection, motion) => actions.openNote(selection.id, motion)}
          onReposition={actions.repositionSelection}
        />

        <CellAttentionIndicator
          view={cellAttentionView}
          onLabelMeasure={measureCellAttentionLabel}
        />

        {noteSelection && noteWorkflow ? (
          <SelectionNoteEditor
            key={`${noteSelection.id}:${noteSelection.note}`}
            selection={noteSelection}
            initialNote={noteSelection.note}
            saving={busySelectionIds.has(noteSelection.id)}
            mutationPending={busySelectionIds.has(noteSelection.id) || ui.clearPending}
            motion={noteWorkflow.motion}
            saveError={noteWorkflow.error}
            onSave={(note) => actions.saveNote(noteSelection.id, note)}
            onCancel={() => {
              dispatch({ type: "closeNote" });
              focusSelectionOrDock(dom, noteSelection.id);
            }}
            onDelete={() => actions.deleteSelection(noteSelection)}
          />
        ) : null}

        <LensStatus message={ui.announcement} />
        <CellAttentionAnnouncement presentation={cellAttention} />
      </LensPortal>
    </>
  );
}

function mergeSelections(stored: Selection[], pending: Selection[]): Selection[] {
  const merged = new Map(stored.map((selection) => [selection.id, selection]));
  for (const selection of pending) {
    if (!merged.has(selection.id)) merged.set(selection.id, selection);
  }
  return [...merged.values()];
}

function useOutputCapture(protocol: LensProtocolClient, dom: NotebookDomAdapter): void {
  useEffect(
    () =>
      protocol.onOutputCapture(async (command, signal) => {
        await dom.afterNextPaint(signal);
        const output = dom.getOutputCell(command.payload.outputCellId);
        if (!output) {
          throw new LensProtocolError(
            "output_unavailable",
            `Output ${command.payload.outputCellId} is unavailable`,
          );
        }
        const element = output.element;
        const result = await captureOutputSnapshot({
          imageId: `image:${command.requestId}`,
          output: element,
          signal,
        });
        const current = dom.getOutputCell(command.payload.outputCellId);
        if (!element.isConnected || current?.element !== element) {
          throw new LensProtocolError(
            "capture_failed",
            "The output changed before capture completed",
          );
        }
        return {
          image: result.metadata,
          bytes: result.bytes,
        };
      }),
    [dom, protocol],
  );
}

function useCellAttention(
  protocol: LensProtocolClient,
  dom: NotebookDomAdapter,
): CellAttentionPresentation | null {
  const [presentation, setPresentation] = useState<CellAttentionPresentation | null>(null);
  const controller = useMemo(() => new CellAttentionController(dom, setPresentation), [dom]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    const releaseAttention = protocol.onCellAttention((event) => {
      const active = dom.document.activeElement;
      if (
        event.type !== "cell.activity.stop" &&
        active instanceof dom.window.HTMLElement &&
        active.closest("[data-marimo-lens-resolution-receipt]")
      ) {
        focusDock(dom);
      }
      if (event.type === "cell.activity.start") controller.startActivity(event);
      else if (event.type === "cell.activity.stop") controller.stopActivity(event);
      else controller.reveal(event);
    });
    return () => {
      releaseAttention();
    };
  }, [controller, dom, protocol]);
  return presentation;
}
