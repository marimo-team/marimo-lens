import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Selection, SelectionResolvedEvent } from "@/contracts";

import { getOutputCell } from "@/capture/output-root";
import { useLatestCommitted } from "@/committed-ref";
import { LensDock } from "@/components/lens-dock";
import { LensPortal } from "@/components/lens-portal";
import { LensStatus } from "@/components/lens-status";
import { ResolutionReceipt } from "@/components/resolution-receipt";
import { SelectionNoteEditor } from "@/components/selection-note-editor";
import { SelectionOverlay, type AdjustmentCancel } from "@/components/selection-overlay";
import { useDocumentInteractions } from "@/document-interactions";
import { focusSelectionOrDock } from "@/focus";
import { useLensModel } from "@/model";
import { useAvailableOutputCellIds } from "@/output-availability";
import { revealSelection } from "@/reveal";
import { useSelectionActions } from "@/selection-actions";
import { INITIAL_UI_STATE, locksCompetingInteractions, uiReducer } from "@/state";

export function MarimoLensContent() {
  const model = useLensModel();
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const uiRef = useLatestCommitted(ui);
  const stateRef = useLatestCommitted(model.state);
  const canceledPointerIds = useRef(new Set<number>());
  const activeAdjustment = useRef<AdjustmentCancel | null>(null);
  const [queuedResolution, setQueuedResolution] = useState<SelectionResolvedEvent | null>(null);
  const [resolutionReceipt, setResolutionReceipt] = useState<SelectionResolvedEvent | null>(null);
  const resolutionFocus = useRef<{
    revision: number;
    selectionId: string;
    element: HTMLElement | null;
  } | null>(null);

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
    protocol: model.protocol,
  });
  const { invalidateSnapshotCapture } = actions;

  useEffect(() => {
    let latestRevision = -1;
    return model.protocol.onSelectionResolved((event) => {
      if (event.revision <= latestRevision) return;
      latestRevision = event.revision;
      invalidateSnapshotCapture(event.payload.selectionId);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resolutionFocus.current = {
        revision: event.revision,
        selectionId: event.payload.selectionId,
        element: focusedSelectionId(active) === event.payload.selectionId ? active : null,
      };
      setQueuedResolution(event);
    });
  }, [invalidateSnapshotCapture, model.protocol]);

  useEffect(() => {
    if (!resolutionReceipt) return undefined;
    const timeout = window.setTimeout(() => {
      setResolutionReceipt((current) => (current === resolutionReceipt ? null : current));
    }, 6_000);
    return () => window.clearTimeout(timeout);
  }, [resolutionReceipt]);

  useDocumentInteractions({
    workflow: ui.workflow,
    uiRef,
    dispatch,
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
  const noteWorkflow = ui.workflow.mode === "editingNote" ? ui.workflow : null;
  const noteSelection = noteWorkflow
    ? (selections.find(({ id }) => id === noteWorkflow.selectionId) ?? null)
    : null;
  const reconciledResolution =
    queuedResolution &&
    model.state.revision >= queuedResolution.revision &&
    !model.state.selections.some(({ id }) => id === queuedResolution.payload.selectionId)
      ? queuedResolution
      : null;

  useEffect(() => {
    if (!reconciledResolution) return;
    setResolutionReceipt(reconciledResolution);
    setQueuedResolution((current) => (current === reconciledResolution ? null : current));
    dispatch({
      type: "announce",
      message: `${reconciledResolution.payload.label} resolved.${reconciledResolution.payload.summary ? ` ${reconciledResolution.payload.summary}` : ""}`,
    });

    const focus = resolutionFocus.current;
    if (
      focus?.revision === reconciledResolution.revision &&
      focus.selectionId === reconciledResolution.payload.selectionId &&
      focus.element &&
      (document.activeElement === focus.element ||
        (!focus.element.isConnected && document.activeElement === document.body))
    ) {
      focusSelectionOrDock(model.state.currentSelectionId ?? focus.selectionId);
    }
    if (focus?.revision === reconciledResolution.revision) resolutionFocus.current = null;
  }, [model.state.currentSelectionId, reconciledResolution]);

  useEffect(() => {
    const workflow = ui.workflow;
    if (
      workflow.mode === "editingNote" &&
      !selections.some(({ id }) => id === workflow.selectionId)
    ) {
      dispatch({ type: "closeNote" });
    }
    if (ui.listOpen && selections.length === 0) {
      dispatch({ type: "setListOpen", open: false });
    }
  }, [selections, ui.listOpen, ui.workflow]);

  const interactionLocked = locksCompetingInteractions(ui);
  const loadSnapshot = useCallback(
    (selectionId: string) => model.protocol.getSnapshot(selectionId),
    [model.protocol],
  );

  return (
    <>
      <LensPortal css={model.lensCss}>
        <LensDock
          selections={selections}
          currentSelectionId={currentSelectionId}
          availableOutputCellIds={availableOutputCellIds}
          armed={ui.workflow.mode === "armed" || ui.workflow.mode === "dragging"}
          listOpen={ui.listOpen}
          clearPending={ui.clearPending}
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          interactionLocked={interactionLocked}
          resolutionReceipt={
            resolutionReceipt ? (
              <ResolutionReceipt
                key={`${resolutionReceipt.revision}:${resolutionReceipt.payload.selectionId}`}
                event={resolutionReceipt}
              />
            ) : null
          }
          onToggleArmed={() =>
            dispatch(
              ui.workflow.mode === "armed" || ui.workflow.mode === "dragging"
                ? { type: "disarm" }
                : { type: "arm" },
            )
          }
          onToggleList={() => dispatch({ type: "setListOpen", open: !ui.listOpen })}
          onClearSelections={actions.clearSelections}
          onActivateSelection={(selection, motion) => {
            if (getOutputCell(selection.outputCellId)) {
              revealSelection(selection, motion);
            } else {
              dispatch({ type: "announce", message: "Output unavailable." });
            }
            actions.activateSelection(selection.id);
          }}
          onEditNote={(selection, motion) => actions.openNote(selection.id, motion)}
          onDeleteSelection={actions.deleteSelection}
          loadSnapshot={loadSnapshot}
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
          onDelete={actions.deleteSelection}
          loadSnapshot={loadSnapshot}
          onReposition={actions.repositionSelection}
        />

        {noteSelection && noteWorkflow ? (
          <SelectionNoteEditor
            key={noteSelection.id}
            selection={noteSelection}
            note={noteSelection.note}
            saving={busySelectionIds.has(noteSelection.id)}
            mutationPending={busySelectionIds.has(noteSelection.id) || ui.clearPending}
            motion={noteWorkflow.motion}
            saveError={noteWorkflow.error}
            capturingSnapshot={capturingSelectionIds.has(noteSelection.id)}
            onSave={(note) => actions.saveNote(noteSelection.id, note)}
            onCancel={() => {
              dispatch({ type: "closeNote" });
              focusSelectionOrDock(noteSelection.id);
            }}
            onDelete={() => actions.deleteSelection(noteSelection)}
            onRetrySnapshot={() => actions.refreshSnapshot(noteSelection)}
          />
        ) : null}

        <LensStatus message={ui.announcement} />
      </LensPortal>
    </>
  );
}

function focusedSelectionId(element: HTMLElement | null): string | null {
  return (
    element?.closest<HTMLElement>("[data-marimo-lens-selection-cluster]")?.dataset
      .marimoLensSelectionCluster ?? null
  );
}

function mergeSelections(stored: Selection[], pending: Selection[]): Selection[] {
  const merged = new Map(stored.map((selection) => [selection.id, selection]));
  for (const selection of pending) {
    if (!merged.has(selection.id)) merged.set(selection.id, selection);
  }
  return [...merged.values()];
}
