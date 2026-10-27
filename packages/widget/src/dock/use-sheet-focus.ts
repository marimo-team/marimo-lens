import { useLayoutEffect, useRef, type RefObject } from "react";

import type { RequestSheetTab } from "@/selection/state";

type SheetFocus = {
  open: boolean;
  historyRevision: number | null;
};

export function useSheetFocus(
  dockRef: RefObject<HTMLElement | null>,
  open: boolean,
  sheetTab: RequestSheetTab,
  focusedHistoryRevision: number | null,
): void {
  const sheetFocusRef = useRef<SheetFocus>({ open: false, historyRevision: null });

  useLayoutEffect(() => {
    const previous = sheetFocusRef.current;
    const shouldFocus =
      open &&
      (!previous.open ||
        (focusedHistoryRevision !== null && focusedHistoryRevision !== previous.historyRevision));
    sheetFocusRef.current = { open, historyRevision: focusedHistoryRevision };
    if (!shouldFocus) return;
    const dock = dockRef.current;
    const target =
      sheetTab === "history"
        ? focusedHistoryRevision === null
          ? dock?.querySelector<HTMLElement>("#marimo-lens-history-tab")
          : (dock?.querySelector<HTMLElement>(
              `[data-marimo-lens-history-revision="${focusedHistoryRevision}"] [data-marimo-lens-history-reopen]`,
            ) ?? dock?.querySelector<HTMLElement>("#marimo-lens-history-tab"))
        : (dock?.querySelector<HTMLElement>(
            '[data-marimo-lens-selection-list] [aria-current="true"]',
          ) ??
          dock?.querySelector<HTMLElement>(
            "[data-marimo-lens-selection-list] [data-marimo-lens-selection-summary]",
          ) ??
          dock?.querySelector<HTMLElement>("#marimo-lens-open-tab"));
    target?.focus();
  }, [dockRef, focusedHistoryRevision, open, sheetTab]);
}
