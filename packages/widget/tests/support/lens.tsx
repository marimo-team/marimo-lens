import type { ReactNode } from "react";

import type { LensActions, LensMeta, LensSheet, LensState } from "@/context/lens-context";

import { LensContext } from "@/context/lens-context";
import { SelectionSnapshotLoader } from "@/selection/selection-snapshot-loader";

/** A Lens state with no selections and no History. */
export function lensState(
  overrides: Omit<Partial<LensState>, "sheet"> & { sheet?: Partial<LensSheet> } = {},
): LensState {
  return {
    selections: [],
    currentSelectionId: null,
    availableSelectionIds: new Set(),
    busySelectionIds: new Set(),
    history: [],
    armed: false,
    interactionLocked: false,
    clearPending: false,
    historyClearPending: false,
    receipt: null,
    ...overrides,
    sheet: {
      open: false,
      tab: "open",
      focusedHistoryRevision: null,
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
    openResolution: ignore,
    activateSelection: ignore,
    editNote: ignore,
    deleteSelection: ignore,
    clearSelections: ignore,
    clearHistory: ignore,
    reopen: ignore,
    setReceiptInteraction: ignore,
    ...overrides,
  };
}

export function lensMeta(overrides: Partial<LensMeta> = {}): LensMeta {
  return {
    snapshotLoader: new SelectionSnapshotLoader(() =>
      Promise.reject(new Error("Snapshot fixture unavailable")),
    ),
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
