import type { ReactNode } from "react";

import type { LensActions, LensMeta, LensSheet, LensState } from "@/context/lens-context";

import { LensContext } from "@/context/lens-context";
import { indexRecord } from "@/context/record-index";

import { historyFixture } from "./fixtures";

/** A Lens state with History and no requests. `record` follows `history`. */
export function lensState(
  overrides: Omit<Partial<LensState>, "sheet" | "record"> & { sheet?: Partial<LensSheet> } = {},
): LensState {
  const history = overrides.history === undefined ? historyFixture() : overrides.history;
  return {
    selections: [],
    currentSelectionId: null,
    availableSelectionIds: new Set(),
    busySelectionIds: new Set(),
    chats: [],
    armed: false,
    interactionLocked: false,
    clearPending: false,
    receipt: null,
    ...overrides,
    history,
    record: indexRecord(history),
    sheet: {
      open: false,
      tab: "open",
      focusedHistoryKey: null,
      shapedOnly: false,
      ...overrides.sheet,
    },
  };
}

export function lensActions(overrides: Partial<LensActions> = {}): LensActions {
  const ignore = () => {};
  return {
    toggleArmed: ignore,
    toggleSheet: ignore,
    setSheetTab: ignore,
    setShapedOnly: ignore,
    openResolution: ignore,
    activateSelection: ignore,
    editNote: ignore,
    deleteSelection: ignore,
    clearSelections: ignore,
    reopen: ignore,
    revealCells: ignore,
    dismissReceipt: ignore,
    setReceiptInteraction: ignore,
    ...overrides,
  };
}

export function lensMeta(overrides: Partial<LensMeta> = {}): LensMeta {
  return {
    loadSnapshot: () => Promise.reject(new Error("Snapshot fixture unavailable")),
    loadHistoryImage: () => Promise.reject(new Error("no image")),
    ...overrides,
  };
}

export function LensTestProvider({
  state,
  actions = lensActions(),
  meta = lensMeta(),
  children,
}: {
  state: LensState;
  actions?: LensActions;
  meta?: LensMeta;
  children: ReactNode;
}) {
  return <LensContext value={{ state, actions, meta }}>{children}</LensContext>;
}
