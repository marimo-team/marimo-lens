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
    return new Set(
      selections
        .filter((selection) => dom.getTarget(selection.target, selector) !== null)
        .map(({ id }) => id),
    );
  }, [dom, layoutRevision, selections, selector]);
}
