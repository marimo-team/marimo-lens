import { useEffect, useMemo, useState } from "react";

import type { Selection } from "@/contracts";

import { getOutputCell } from "@/capture/output-root";

export function useAvailableOutputCellIds(selections: readonly Selection[]): ReadonlySet<string> {
  const outputCellIds = useMemo(
    () => [...new Set(selections.map(({ outputCellId }) => outputCellId))].sort(),
    [selections],
  );
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (outputCellIds.length === 0 || typeof MutationObserver === "undefined") return undefined;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setRevision((current) => current + 1);
      });
    };
    const outputDomIds = new Set(outputCellIds.map((outputCellId) => `output-${outputCellId}`));
    const observedOutputs = new Map<string, HTMLElement>();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const syncObservedOutputs = () => {
      if (!resizeObserver) return;
      for (const outputDomId of outputDomIds) {
        const next = document.getElementById(outputDomId);
        const previous = observedOutputs.get(outputDomId);
        if (next === previous) continue;
        if (previous) resizeObserver.unobserve(previous);
        if (next instanceof HTMLElement) {
          observedOutputs.set(outputDomId, next);
          resizeObserver.observe(next);
        } else {
          observedOutputs.delete(outputDomId);
        }
      }
    };
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => recordTouchesOutput(record, outputDomIds))) return;
      syncObservedOutputs();
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    syncObservedOutputs();

    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [outputCellIds]);

  return new Set(outputCellIds.filter((outputCellId) => getOutputCell(outputCellId) !== null));
}

function recordTouchesOutput(record: MutationRecord, outputDomIds: ReadonlySet<string>): boolean {
  return (
    belongsToOutput(record.target, outputDomIds) ||
    [...record.addedNodes, ...record.removedNodes].some((node) =>
      containsOutput(node, outputDomIds),
    )
  );
}

function belongsToOutput(node: Node, outputDomIds: ReadonlySet<string>): boolean {
  let current = node instanceof Element ? node : node.parentElement;
  while (current) {
    if (current instanceof HTMLElement && outputDomIds.has(current.id)) return true;
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

function containsOutput(node: Node, outputDomIds: ReadonlySet<string>): boolean {
  if (node instanceof HTMLElement && outputDomIds.has(node.id)) return true;
  if (!(node instanceof Element || node instanceof DocumentFragment)) return false;
  return [...node.querySelectorAll<HTMLElement>("[id]")].some((element) =>
    outputDomIds.has(element.id),
  );
}
