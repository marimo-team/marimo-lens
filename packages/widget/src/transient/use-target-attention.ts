import type { AttentionAddress, AttentionEvent, LensState } from "@marimo-lens/protocol";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

import { targetBelongsToDocument } from "@/notebook/selection-target";
import {
  cellAddressTarget,
  type TargetAttentionPresentation,
  TargetAttentionController,
  type TargetLocator,
} from "@/transient/target-attention";
import { focusDock } from "@/ui/focus";

export function useTargetAttention(
  protocol: LensProtocolClient,
  dom: NotebookDomAdapter,
  state: LensState,
  selector: string | null,
): TargetAttentionPresentation | null {
  const [presentation, setPresentation] = useState<TargetAttentionPresentation | null>(null);
  const pending = useRef<PendingAttentionEvent[]>([]);
  const [attentionEventSequence, setAttentionEventSequence] = useState(0);
  const controller = useMemo(() => new TargetAttentionController(dom, setPresentation), [dom]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    pending.current = [];
    const releaseAttention = protocol.onAttention((event) => {
      if (event.type === "attention.activity.stop") {
        pending.current = pending.current.filter(
          (candidate) =>
            candidate.type !== "attention.activity.start" ||
            candidate.payload.activityId !== event.payload.activityId,
        );
        controller.stopActivity(event);
        setAttentionEventSequence((current) => current + 1);
        return;
      }
      pending.current.push(event);
      setAttentionEventSequence((current) => current + 1);
    });
    return () => {
      pending.current = [];
      releaseAttention();
    };
  }, [controller, protocol]);
  useEffect(() => {
    const blockedIndex = pending.current.findIndex(
      ({ payload: { address } }) =>
        address.kind === "selection" && state.revision < address.revision,
    );
    const ready = blockedIndex === -1 ? pending.current : pending.current.slice(0, blockedIndex);
    if (ready.length === 0) return;
    pending.current = pending.current.slice(ready.length);
    for (const event of ready) {
      const locator = resolveTarget(event.payload.address, state, selector, dom);
      if (!locator) continue;
      const active = dom.activeElement;
      if (
        active instanceof dom.window.HTMLElement &&
        active.closest("[data-marimo-lens-resolution-receipt]")
      ) {
        focusDock(dom);
      }
      if (event.type === "attention.activity.start") {
        controller.startActivity(event, locator);
      } else {
        controller.reveal(event, locator);
      }
    }
  }, [attentionEventSequence, controller, dom, selector, state]);
  return presentation;
}

type PendingAttentionEvent = Exclude<AttentionEvent, { type: "attention.activity.stop" }>;

function resolveTarget(
  address: AttentionAddress,
  state: LensState,
  selector: string | null,
  dom: NotebookDomAdapter,
): TargetLocator | null {
  if (address.kind === "cell") {
    return {
      kind: "cell",
      label: address.cellId,
      resolve: () => cellAddressTarget(dom, address.cellId),
    };
  }
  // Open selection identity and target are immutable, so a later canonical
  // revision can safely resolve an event whose model update was coalesced.
  if (state.revision < address.revision) return null;
  const selection = state.selections.find((candidate) => candidate.id === address.selectionId);
  if (!selection || !targetBelongsToDocument(selection.target, dom.document)) return null;
  return {
    kind: "selection",
    label: selection.label,
    resolve: () => dom.getTarget(selection.target, selector)?.element ?? null,
  };
}
