import type { LensState, SelectionResolvedEvent } from "@marimo-lens/protocol";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";
import type { UiAction } from "@/selection/state";

import { focusSelectionOrDock } from "@/ui/focus";

export function useResolutionReceipt(options: {
  state: LensState;
  protocol: LensProtocolClient;
  dom: NotebookDomAdapter;
  dispatch: Dispatch<UiAction>;
  invalidateSnapshotCapture: (selectionId: string) => void;
}): {
  receipt: SelectionResolvedEvent | null;
  setInteraction: (event: SelectionResolvedEvent, active: boolean) => void;
} {
  const { state, protocol, dom, dispatch, invalidateSnapshotCapture } = options;
  const [queued, setQueued] = useState<SelectionResolvedEvent | null>(null);
  const [receipt, setReceipt] = useState<SelectionResolvedEvent | null>(null);
  const [pausedRevision, setPausedRevision] = useState<number | null>(null);
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
    if (!receipt || pausedRevision === receipt.revision) return undefined;
    const timeout = dom.window.setTimeout(() => {
      setReceipt((current) => (current === receipt ? null : current));
    }, 6_000);
    return () => dom.window.clearTimeout(timeout);
  }, [dom, pausedRevision, receipt]);

  const setInteraction = useCallback((event: SelectionResolvedEvent, active: boolean) => {
    setPausedRevision((current) =>
      active ? event.revision : current === event.revision ? null : current,
    );
  }, []);

  const reconciled =
    queued &&
    state.revision >= queued.revision &&
    queued.payload.selections.every(
      (resolved) =>
        !state.selections.some(({ id }) => id === resolved.selectionId) &&
        state.history.some(
          (candidate) =>
            candidate.selectionId === resolved.selectionId &&
            candidate.resolutionRevision === resolved.resolutionRevision,
        ),
    )
      ? queued
      : null;

  useEffect(() => {
    if (!reconciled) return;
    setReceipt(reconciled);
    setQueued((current) => (current === reconciled ? null : current));
    const resolved = reconciled.payload.selections;
    const resolutionLabel =
      resolved.length === 1
        ? `${resolved[0]!.label} addressed.`
        : `${resolved.length} selections addressed.`;
    dispatch({
      type: "announce",
      message: `${resolutionLabel}${reconciled.payload.summary ? ` ${reconciled.payload.summary}` : ""}`,
    });

    const pendingFocus = focus.current;
    if (
      pendingFocus?.revision === reconciled.revision &&
      pendingFocus.element &&
      (dom.document.activeElement === pendingFocus.element ||
        (!pendingFocus.element.isConnected && dom.document.activeElement === dom.document.body))
    ) {
      focusSelectionOrDock(dom, state.currentSelectionId ?? pendingFocus.selectionId);
    }
    if (pendingFocus?.revision === reconciled.revision) focus.current = null;
  }, [dispatch, dom, reconciled, state.currentSelectionId]);

  return { receipt, setInteraction };
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
