import { useEffect } from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

const HISTORY_REFRESH_MS = 5_000;

export function useHistoryRefresh(
  protocol: LensProtocolClient,
  dom: NotebookDomAdapter,
  historyVisible: boolean,
): void {
  useEffect(() => {
    // History follows the record and the notebook, which change without a
    // selection revision, so a visible History tab keeps asking Python for a
    // fresh view, one request at a time.
    if (!historyVisible) return undefined;
    const view = dom.window;
    let inFlight = false;
    const refresh = () => {
      if (inFlight || view.document.visibilityState === "hidden") return;
      inFlight = true;
      void protocol
        .refreshHistory()
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const interval = view.setInterval(refresh, HISTORY_REFRESH_MS);
    view.addEventListener("focus", refresh);
    return () => {
      view.clearInterval(interval);
      view.removeEventListener("focus", refresh);
    };
  }, [dom, historyVisible, protocol]);
}
