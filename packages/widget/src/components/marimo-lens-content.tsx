import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Selection } from "@/contracts";

import { useLatestCommitted } from "@/committed-ref";
import { LensDock } from "@/components/lens-dock";
import { LensPortal } from "@/components/lens-portal";
import { LensStatus } from "@/components/lens-status";
import { SelectionNoteEditor } from "@/components/selection-note-editor";
import { SelectionOverlay, type AdjustmentCancel } from "@/components/selection-overlay";
import { useDocumentInteractions } from "@/document-interactions";
import { focusSelectionOrDock } from "@/focus";
import { useLensModel } from "@/model";
import { useSelectionActions } from "@/selection-actions";
import { INITIAL_UI_STATE, locksCompetingInteractions, uiReducer } from "@/state";

export function MarimoLensContent() {
  const model = useLensModel();
  const [ui, dispatch] = useReducer(uiReducer, INITIAL_UI_STATE);
  const uiRef = useLatestCommitted(ui);
  const stateRef = useLatestCommitted(model.state);
  const canceledPointerIds = useRef(new Set<number>());
  const activeAdjustment = useRef<AdjustmentCancel | null>(null);
  const seenPendingSelectionId = useRef<string | null>(null);
  const receiptTimer = useRef<number | null>(null);
  const [receiptSelectionId, setReceiptSelectionId] = useState<string | null>(null);
  const [lifecycle] = useState(() => new AbortController());

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
      lifecycle.abort();
      activeAdjustment.current?.();
      activeAdjustment.current = null;
      if (receiptTimer.current !== null) window.clearTimeout(receiptTimer.current);
    },
    [lifecycle],
  );

  const actions = useSelectionActions({
    stateRef,
    dispatch,
    protocol: model.protocol,
    signal: lifecycle.signal,
  });

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
  const busySelectionIds = useMemo(() => new Set(ui.busySelectionIds), [ui.busySelectionIds]);
  const capturingSelectionIds = useMemo(
    () =>
      new Set(
        selections
          .filter(({ snapshot }) => snapshot.status === "pending")
          .map((selection) => selection.id),
      ),
    [selections],
  );
  const noteWorkflow = ui.workflow.mode === "editingNote" ? ui.workflow : null;
  const noteSelection = noteWorkflow
    ? (selections.find(({ id }) => id === noteWorkflow.selectionId) ?? null)
    : null;
  const receiptSelection = receiptSelectionId
    ? (selections.find(({ id }) => id === receiptSelectionId) ?? null)
    : null;
  const interactionLocked = locksCompetingInteractions(ui);

  const latestPending = ui.pendingSelections.at(-1)?.selection;
  useEffect(() => {
    if (!latestPending || latestPending.id === seenPendingSelectionId.current) return;
    seenPendingSelectionId.current = latestPending.id;
    setReceiptSelectionId(latestPending.id);
    if (receiptTimer.current !== null) window.clearTimeout(receiptTimer.current);
    receiptTimer.current = window.setTimeout(() => {
      setReceiptSelectionId(null);
      receiptTimer.current = null;
    }, 4_000);
  }, [latestPending]);

  return (
    <>
      <span hidden data-marimo-lens-host data-marimo-lens-ui />
      <LensPortal css={model.lensCss}>
        <LensDock
          selections={selections}
          currentSelectionId={currentSelectionId}
          armed={ui.workflow.mode === "armed" || ui.workflow.mode === "dragging"}
          listOpen={ui.listOpen}
          menuOpen={ui.menuOpen}
          exportState={ui.export}
          capturingSelectionIds={capturingSelectionIds}
          busySelectionIds={busySelectionIds}
          interactionLocked={interactionLocked}
          selectionReceipt={receiptSelection ? { selection: receiptSelection } : null}
          onToggleArmed={() =>
            dispatch(
              ui.workflow.mode === "armed" || ui.workflow.mode === "dragging"
                ? { type: "disarm" }
                : { type: "arm" },
            )
          }
          onToggleList={() => dispatch({ type: "setListOpen", open: !ui.listOpen })}
          onToggleMenu={() => dispatch({ type: "setMenuOpen", open: !ui.menuOpen })}
          onCopyContext={actions.copyContext}
          onClearSelections={actions.clearSelections}
          onActivateSelection={(selection) => actions.activateSelection(selection.id)}
          onEditNote={(selection) => actions.openNote(selection.id)}
          onDeleteSelection={actions.deleteSelection}
        />

        <SelectionOverlay
          selections={selections}
          currentSelectionId={currentSelectionId}
          workflow={ui.workflow}
          busySelectionIds={busySelectionIds}
          capturingSelectionIds={capturingSelectionIds}
          registerAdjustment={registerAdjustment}
          releaseAdjustment={releaseAdjustment}
          onActivate={(selection) => actions.activateSelection(selection.id)}
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

function mergeSelections(stored: Selection[], pending: Selection[]): Selection[] {
  const merged = new Map(stored.map((selection) => [selection.id, selection]));
  for (const selection of pending) {
    if (!merged.has(selection.id)) merged.set(selection.id, selection);
  }
  return [...merged.values()];
}
