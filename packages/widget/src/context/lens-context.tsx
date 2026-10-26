import type {
  ChatRequest,
  HistoryEntry,
  HistoryState,
  Selection,
  SelectionResolvedEvent,
} from "@marimo-lens/protocol";

import { createContext, use } from "react";

import type { SnapshotAsset } from "@/anywidget/client";
import type { RevealMotion } from "@/selection/reveal";
import type { SelectionMotion, RequestSheetTab } from "@/selection/state";

import type { RecordIndex } from "./record-index";

/** The requests sheet as the dock shows it. */
export type LensSheet = {
  open: boolean;
  tab: RequestSheetTab;
  /** The History entry to focus when the sheet opens on History. */
  focusedHistoryKey: string | null;
  /** History lists only the requests that shaped the current selection. */
  shapedOnly: boolean;
};

export type LensState = {
  selections: readonly Selection[];
  currentSelectionId: string | null;
  availableSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  /** The runtime's open chat requests. */
  chats: readonly ChatRequest[];
  /** Null for a Lens that shows no History. */
  history: HistoryState | null;
  record: RecordIndex;
  armed: boolean;
  interactionLocked: boolean;
  clearPending: boolean;
  sheet: LensSheet;
  receipt: SelectionResolvedEvent | null;
};

export type LensActions = {
  toggleArmed: () => void;
  toggleSheet: () => void;
  setSheetTab: (tab: RequestSheetTab) => void;
  setShapedOnly: (enabled: boolean) => void;
  openResolution: (event: SelectionResolvedEvent) => void;
  activateSelection: (selection: Selection, motion: RevealMotion) => void;
  editNote: (selection: Selection, motion: SelectionMotion) => void;
  deleteSelection: (selection: Selection) => void;
  clearSelections: () => void;
  reopen: (entry: HistoryEntry) => void;
  revealCells: (entry: HistoryEntry) => void;
  dismissReceipt: (event: SelectionResolvedEvent) => void;
  setReceiptInteraction: (event: SelectionResolvedEvent, active: boolean) => void;
};

export type LensMeta = {
  loadSnapshot: (selectionId: string) => Promise<SnapshotAsset>;
  loadHistoryImage: (sha256: string) => Promise<Uint8Array<ArrayBuffer>>;
};

export type LensContextValue = {
  state: LensState;
  actions: LensActions;
  meta: LensMeta;
};

/**
 * The Lens's state, actions, and services. The app provides it, and the dock,
 * History, and receipt read it, so they render the same requests and record
 * however the provider produces them.
 */
export const LensContext = createContext<LensContextValue | null>(null);

export function useLens(): LensContextValue {
  const value = use(LensContext);
  if (!value) throw new Error("Lens components need a LensContext provider");
  return value;
}
