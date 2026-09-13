import type { Selection, TargetSelector } from "@marimo-lens/protocol";

import { useMemo } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { useViewportRevision } from "@/notebook/viewport";

export function useAvailableSelectionIds(
  selections: readonly Selection[],
  selector: TargetSelector,
): ReadonlySet<string> {
  const dom = useNotebookDom();
  const layoutRevision = useViewportRevision(selections.length > 0, selector);

  return useMemo(() => {
    void layoutRevision;
    const targets = new Map<string, boolean>();
    const available = new Set<string>();
    for (const selection of selections) {
      const key = JSON.stringify(selection.target);
      let present = targets.get(key);
      if (present === undefined) {
        present = dom.getTarget(selection.target, selector) !== null;
        targets.set(key, present);
      }
      if (present) available.add(selection.id);
    }
    return available;
  }, [dom, layoutRevision, selections, selector]);
}
