import type { LensSheet } from "@/context/lens-context";
import type { UiState } from "@/selection/state";

/**
 * Show the sheet on a tab that has something to list. A requested tab with
 * nothing to show yields to the other one, and a sheet with nothing on either
 * tab stays closed until selections or History arrive.
 */
export function sheetView(ui: UiState, openRequests: number, history: number): LensSheet {
  let tab = ui.sheetTab;
  if (tab === "open" && openRequests === 0 && history > 0) tab = "history";
  else if (tab === "history" && history === 0 && openRequests > 0) tab = "open";
  return {
    open: ui.sheetOpen && (openRequests > 0 || history > 0),
    tab,
    focusedHistoryRevision: ui.focusedHistoryRevision,
  };
}
