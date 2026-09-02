import type { AttentionAddress, LensState } from "@marimo-lens/protocol";

import { useEffect, useMemo, useState } from "react";

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
  stateRef: Readonly<{ current: LensState }>,
  selector: string | null,
): TargetAttentionPresentation | null {
  const [presentation, setPresentation] = useState<TargetAttentionPresentation | null>(null);
  const controller = useMemo(() => new TargetAttentionController(dom, setPresentation), [dom]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    const releaseAttention = protocol.onAttention((event) => {
      if (event.type === "attention.activity.stop") {
        controller.stopActivity(event);
        return;
      }
      const locator = resolveTarget(event.payload.address, stateRef.current, selector, dom);
      if (!locator) return;
      const active = dom.document.activeElement;
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
    });
    return releaseAttention;
  }, [controller, dom, protocol, selector, stateRef]);
  return presentation;
}

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
  if (state.revision !== address.revision) return null;
  const selection = state.selections.find((candidate) => candidate.id === address.selectionId);
  if (!selection || !targetBelongsToDocument(selection.target, dom.document)) return null;
  return {
    kind: "selection",
    label: selection.label,
    resolve: () => dom.getTarget(selection.target, selector)?.element ?? null,
  };
}
