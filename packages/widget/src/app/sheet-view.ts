import type { HistoryState } from "@marimo-lens/protocol";

import type { LensSheet } from "@/context/lens-context";
import type { UiState } from "@/selection/state";

import { historyShows } from "@/context/record-index";

/**
 * Show the sheet on a tab that has something to list. A requested tab with
 * nothing to show yields to the other one, and a sheet with nothing on either
 * tab stays closed until requests or History arrive.
 */
export function sheetView(
  ui: UiState,
  openRequests: number,
  history: HistoryState | null,
): LensSheet {
  const historyAvailable = historyShows(history);
  let tab = ui.sheetTab;
  if (tab === "open" && openRequests === 0 && historyAvailable) tab = "history";
  else if (tab === "history" && !historyAvailable && openRequests > 0) tab = "open";
  return {
    open: ui.sheetOpen && (openRequests > 0 || historyAvailable),
    tab,
    focusedHistoryKey: ui.focusedHistoryKey,
    shapedOnly: ui.historyShapedOnly,
  };
}
