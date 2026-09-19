import type { Selection, TargetSelector } from "@marimo-lens/protocol";

import { useMemo, useSyncExternalStore } from "react";

import { useNotebookDom } from "@/notebook/notebook-dom";

export function useAvailableSelectionIds(
  selections: readonly Selection[],
  selector: TargetSelector,
): ReadonlySet<string> {
  const dom = useNotebookDom();
  const store = useMemo(() => {
    let available = new Set<string>();
    return {
      subscribe: (notify: () => void) =>
        selections.length > 0 ? dom.subscribeLayout(notify, selector) : () => {},
      getSnapshot: () => {
        const targets = new Map<string, boolean>();
        const next = new Set<string>();
        for (const selection of selections) {
          const key = JSON.stringify(selection.target);
          let present = targets.get(key);
          if (present === undefined) {
            present = dom.getTarget(selection.target, selector) !== null;
            targets.set(key, present);
          }
          if (present) next.add(selection.id);
        }
        if (next.size !== available.size || [...next].some((id) => !available.has(id))) {
          available = next;
        }
        return available;
      },
    };
  }, [dom, selections, selector]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
