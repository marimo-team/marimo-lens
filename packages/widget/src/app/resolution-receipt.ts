import type { LensState, SelectionResolvedEvent } from "@marimo-lens/protocol";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { UiAction } from "@/selection/state";
import type { TargetAttentionKind } from "@/transient/target-attention";

import { targetBelongsToDocument } from "@/notebook/selection-target";
import { focusSelectionOrDock } from "@/ui/focus";

type ResolutionReceiptOptions = {
  state: LensState;
  protocol: LensProtocolClient;
  dom: NotebookDomAdapter;
  dispatch: Dispatch<UiAction>;
  invalidateSnapshotCapture: (selectionId: string) => void;
  attentionKind: TargetAttentionKind | null;
};

type ResolutionReceiptState = {
  receipt: SelectionResolvedEvent | null;
  setInteraction: (event: SelectionResolvedEvent, active: boolean) => void;
};

export function useResolutionReceipt(options: ResolutionReceiptOptions): ResolutionReceiptState {
  const { state, protocol, dom, dispatch, invalidateSnapshotCapture, attentionKind } = options;
  const suspended = attentionKind !== null;
  const [queued, setQueued] = useState<SelectionResolvedEvent | null>(null);
  const [receipt, setReceipt] = useState<SelectionResolvedEvent | null>(null);
  const [pausedRevision, setPausedRevision] = useState<number | null>(null);
  const presentedRevision = useRef<number | null>(null);
  const focus = useRef<{
    revision: number;
    selectionId: string;
    element: HTMLElement | null;
  } | null>(null);

  useEffect(() => {
    let latestRevision = -1;
    return protocol.onSelectionResolved((event) => {
      if (event.revision <= latestRevision) return;
      latestRevision = event.revision;
      const selectionIds = event.payload.selections.map(({ selectionId }) => selectionId);
      for (const selectionId of selectionIds) invalidateSnapshotCapture(selectionId);
      const active = htmlElement(dom, dom.document.activeElement);
      const activeSelectionId = focusedSelectionId(active);
      const focusedSelection =
        activeSelectionId !== null && selectionIds.includes(activeSelectionId)
          ? activeSelectionId
          : null;
      focus.current = {
        revision: event.revision,
        selectionId: focusedSelection ?? selectionIds[0]!,
        element: focusedSelection ? active : null,
      };
      setQueued(event);
    });
  }, [dom, invalidateSnapshotCapture, protocol]);

  useEffect(() => {
    if (!receipt || suspended || pausedRevision === receipt.revision) return undefined;
    const timeout = dom.window.setTimeout(() => {
      setReceipt((current) => (current === receipt ? null : current));
    }, 6_000);
    return () => dom.window.clearTimeout(timeout);
  }, [dom, pausedRevision, receipt, suspended]);

  useEffect(() => {
    if (
      !receipt ||
      attentionKind !== "activity" ||
      presentedRevision.current !== receipt.revision
    ) {
      return;
    }
    setReceipt((current) => (current === receipt ? null : current));
    setPausedRevision((current) => (current === receipt.revision ? null : current));
  }, [attentionKind, receipt]);

  const setInteraction = useCallback((event: SelectionResolvedEvent, active: boolean) => {
    setPausedRevision((current) =>
      active ? event.revision : current === event.revision ? null : current,
    );
  }, []);

  useEffect(() => {
    if (!queued || state.revision < queued.revision) return;
    const receipts = queued.payload.selections.map((resolved) =>
      state.history.find(
        (candidate) =>
          candidate.selectionId === resolved.selectionId &&
          candidate.resolutionRevision === resolved.resolutionRevision,
      ),
    );
    if (
      receipts.some((candidate) => candidate === undefined) ||
      queued.payload.selections.some((resolved) =>
        state.selections.some(({ id }) => id === resolved.selectionId),
      )
    ) {
      return;
    }
    setQueued((current) => (current === queued ? null : current));
    const ownedSelections = queued.payload.selections.filter((_, index) => {
      const receipt = receipts[index];
      return receipt !== undefined && targetBelongsToDocument(receipt.target, dom.document);
    });
    const documentReceipt =
      ownedSelections.length === 0
        ? null
        : {
            ...queued,
            payload: { ...queued.payload, selections: ownedSelections },
          };
    if (documentReceipt) setReceipt(documentReceipt);
    const pendingFocus = focus.current;
    if (
      pendingFocus?.revision === queued.revision &&
      pendingFocus.element &&
      (dom.document.activeElement === pendingFocus.element ||
        (!pendingFocus.element.isConnected && dom.document.activeElement === dom.document.body))
    ) {
      focusSelectionOrDock(dom, state.currentSelectionId ?? pendingFocus.selectionId);
    }
    if (pendingFocus?.revision === queued.revision) focus.current = null;
  }, [dom, queued, state]);

  useEffect(() => {
    if (!receipt || suspended || presentedRevision.current === receipt.revision) return;
    presentedRevision.current = receipt.revision;
    const resolved = receipt.payload.selections;
    const resolutionLabel =
      resolved.length === 1
        ? `${resolved[0]!.label} addressed.`
        : `${resolved.length} selections addressed.`;
    dispatch({
      type: "announce",
      message: `${resolutionLabel}${receipt.payload.summary ? ` ${receipt.payload.summary}` : ""}`,
    });
  }, [dispatch, receipt, suspended]);

  return { receipt: suspended ? null : receipt, setInteraction };
}

function focusedSelectionId(element: HTMLElement | null): string | null {
  return (
    element?.closest<HTMLElement>("[data-marimo-lens-selection-cluster]")?.dataset
      .marimoLensSelectionCluster ?? null
  );
}

function htmlElement(dom: NotebookDomAdapter, element: Element | null): HTMLElement | null {
  return element instanceof dom.window.HTMLElement ? element : null;
}
