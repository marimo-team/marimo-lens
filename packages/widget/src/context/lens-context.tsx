import type { AddressedSelection, Selection, SelectionResolvedEvent } from "@marimo-lens/protocol";

import { createContext, use } from "react";

import type { RevealMotion } from "@/selection/reveal";
import type { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";
import type { SelectionMotion, RequestSheetTab } from "@/selection/state";

/** The requests sheet as the dock shows it. */
export type LensSheet = {
  open: boolean;
  tab: RequestSheetTab;
  /** The History receipt to focus when the sheet opens on History. */
  focusedHistoryRevision: number | null;
};

export type LensState = {
  selections: readonly Selection[];
  currentSelectionId: string | null;
  availableSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  history: readonly AddressedSelection[];
  armed: boolean;
  interactionLocked: boolean;
  clearPending: boolean;
  historyClearPending: boolean;
  sheet: LensSheet;
  receipt: SelectionResolvedEvent | null;
};

export type LensActions = {
  toggleArmed: () => void;
  toggleSheet: () => void;
  setSheetTab: (tab: RequestSheetTab) => void;
  openResolution: (event: SelectionResolvedEvent) => void;
  activateSelection: (selection: Selection, motion: RevealMotion) => void;
  editNote: (selection: Selection, motion: SelectionMotion) => void;
  deleteSelection: (selection: Selection) => void;
  clearSelections: () => void;
  clearHistory: () => void;
  reopen: (receipt: AddressedSelection) => void;
  setReceiptInteraction: (event: SelectionResolvedEvent, active: boolean) => void;
};

export type LensMeta = {
  snapshotLoader: SelectionSnapshotLoader;
};

export type LensContextValue = {
  state: LensState;
  actions: LensActions;
  meta: LensMeta;
};

/**
 * The Lens's state, actions, and services. The app provides it, and the dock,
 * History, and receipt read it, so they render the same selections however
 * the provider produces them.
 */
export const LensContext = createContext<LensContextValue | null>(null);

export function useLens(): LensContextValue {
  const value = use(LensContext);
  if (!value) throw new Error("Lens components need a LensContext provider");
  return value;
}
