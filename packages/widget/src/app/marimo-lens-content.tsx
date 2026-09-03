import type { Selection } from "@marimo-lens/protocol";

import { captureOutputSnapshot } from "@marimo-lens/image-capture";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { LensProtocolError, type LensProtocolClient } from "@/anywidget/client";
import { useLensModel } from "@/anywidget/model";
import { useLatestCommitted } from "@/app/committed-ref";
import { useResolutionReceipt } from "@/app/resolution-receipt";
import { useNotebookDom, type NotebookDomAdapter } from "@/notebook/notebook-dom";
import { targetBelongsToDocument } from "@/notebook/selection-target";
import { SelectionNoteEditor } from "@/selection/components/selection-note-editor";
import { SelectionOverlay, type AdjustmentCancel } from "@/selection/components/selection-overlay";
import { useDocumentInteractions } from "@/selection/document-interactions";
import { revealSelection } from "@/selection/reveal";
import { useSelectionActions } from "@/selection/selection-actions";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import { INITIAL_UI_STATE, locksCompetingInteractions, uiReducer } from "@/selection/state";
import { useAvailableSelectionIds } from "@/selection/target-availability";
import {
  TargetAttentionAnnouncement,
  TargetAttentionFallback,
  TargetAttentionIndicator,
  projectTargetAttentionSurface,
} from "@/transient/target-attention-indicator";
import { useTargetAttention } from "@/transient/use-target-attention";
import { LensDock } from "@/ui/components/lens-dock";
import { LensPortal } from "@/ui/components/lens-portal";
import { LensStatus } from "@/ui/components/lens-status";
import { focusSelectionOrDock } from "@/ui/focus";

export type MarimoLensContentDependencies = {
  captureOutputSnapshot: typeof captureOutputSnapshot;
  useLensModel: typeof useLensModel;
  useSelectionActions: typeof useSelectionActions;
};

type MarimoLensContentProps = {
  dependencies?: MarimoLensContentDependencies;
};

const defaultDependencies: MarimoLensContentDependencies = {
  captureOutputSnapshot,
  useLensModel,
  useSelectionActions,
};

export function MarimoLensContent(props?: MarimoLensContentProps) {
  const dependencies = props?.dependencies ?? defaultDependencies;
  const dom = useNotebookDom();
  const model = dependencies.useLensModel(dom.window);
  useLayoutEffect(() => dom.configureSelector(model.selector), [dom, model.selector]);
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

  const actions = dependencies.useSelectionActions({
    stateRef,
    dispatch,
    dom,
    selector: model.selector,
    protocol: model.protocol,
  });
  const { invalidateSnapshotCapture, settleUnavailableSnapshot } = actions;
  useOutputCapture(model.protocol, dom, dependencies.captureOutputSnapshot);
  const targetAttention = useTargetAttention(model.protocol, dom, model.state, model.selector);
  const [targetAttentionLabel, setTargetAttentionLabel] = useState<{
    sequence: number;
    height: number;
    maxWidth: number;
  } | null>(null);
  const measureTargetAttentionLabel = useCallback(
    (sequence: number, measurement: { height: number; maxWidth: number }) => {
      setTargetAttentionLabel((current) =>
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
    attentionKind: targetAttention?.kind ?? null,
  });
  const targetAttentionSurface = projectTargetAttentionSurface(
    targetAttention,
    dom.window,
    targetAttentionLabel !== null && targetAttentionLabel.sequence === targetAttention?.sequence
      ? targetAttentionLabel
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
    selector: model.selector,
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
  const availableSelectionIds = useAvailableSelectionIds(selections, model.selector);
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
        targetBelongsToDocument(selection.target, dom.document) &&
        !availableSelectionIds.has(selection.id)
      ) {
        settleUnavailableSnapshot(selection.id);
      }
    }
  }, [availableSelectionIds, dom, selections, settleUnavailableSnapshot]);

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
          availableSelectionIds={availableSelectionIds}
          selector={model.selector}
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
          targetAttentionFallback={
            targetAttentionSurface.fallback ? (
              <TargetAttentionFallback {...targetAttentionSurface.fallback} />
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
          onReopenSelection={(receipt) => {
            if (dom.getTarget(receipt.target, model.selector)) {
              actions.reopenSelection(receipt);
            } else {
              dispatch({ type: "announce", message: "Target unavailable in this document." });
            }
          }}
          onActivateSelection={(selection, motion) => {
            if (dom.getTarget(selection.target, model.selector)) {
              revealSelection(dom, selection, motion, model.selector);
            } else {
              dispatch({ type: "announce", message: "Target unavailable." });
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
          availableSelectionIds={availableSelectionIds}
          selector={model.selector}
          workflow={ui.workflow}
          busySelectionIds={busySelectionIds}
          capturingSelectionIds={capturingSelectionIds}
          registerAdjustment={registerAdjustment}
          releaseAdjustment={releaseAdjustment}
          onActivate={(selection) => actions.activateSelection(selection.id)}
          onEditNote={(selection, motion) => actions.openNote(selection.id, motion)}
          onReposition={actions.repositionSelection}
        />

        <TargetAttentionIndicator
          view={targetAttentionSurface.view}
          onLabelMeasure={measureTargetAttentionLabel}
        />

        {noteSelection && noteWorkflow ? (
          <SelectionNoteEditor
            key={`${noteSelection.id}:${noteSelection.note}`}
            selection={noteSelection}
            selector={model.selector}
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
        <TargetAttentionAnnouncement presentation={targetAttention} />
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

function useOutputCapture(
  protocol: LensProtocolClient,
  dom: NotebookDomAdapter,
  capture: typeof captureOutputSnapshot,
): void {
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
        const result = await capture({
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
    [capture, dom, protocol],
  );
}
