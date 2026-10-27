import type { Selection } from "@marimo-lens/protocol";

import { useMemo, useSyncExternalStore } from "react";

import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

import { useNotebookDom } from "@/notebook/notebook-dom-context";

export function useAvailableSelectionIds(selections: readonly Selection[]): ReadonlySet<string> {
  const dom = useNotebookDom();
  const store = useMemo(() => availabilityStore(dom, selections), [dom, selections]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

function availabilityStore(dom: NotebookDomAdapter, selections: readonly Selection[]) {
  let available = new Set<string>();
  return {
    subscribe: (notify: () => void) =>
      selections.length > 0 ? dom.subscribeLayout(notify) : () => {},
    getSnapshot: (): ReadonlySet<string> => {
      const targets = new Map<string, boolean>();
      const next = new Set<string>();
      for (const selection of selections) {
        const key = JSON.stringify(selection.target);
        let present = targets.get(key);
        if (present === undefined) {
          present = dom.getTarget(selection.target) !== null;
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
}
