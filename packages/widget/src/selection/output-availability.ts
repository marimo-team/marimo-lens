import type { Selection } from "@marimo-lens/protocol";

import { useMemo } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";
import { useViewportRevision } from "@/notebook/viewport";

export function useAvailableOutputCellIds(selections: readonly Selection[]): ReadonlySet<string> {
  const dom = useNotebookDom();
  const outputCellIds = useMemo(
    () => [...new Set(selections.map(({ outputCellId }) => outputCellId))].sort(),
    [selections],
  );
  const layoutRevision = useViewportRevision(outputCellIds.length > 0);

  return useMemo(() => {
    // The revision invalidates this DOM query when the shared layout observer fires.
    void layoutRevision;
    return new Set(
      outputCellIds.filter((outputCellId) => dom.getOutputCell(outputCellId) !== null),
    );
  }, [dom, layoutRevision, outputCellIds]);
}
