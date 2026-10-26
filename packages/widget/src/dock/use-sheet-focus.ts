import { useLayoutEffect, useRef, type RefObject } from "react";

import type { RequestSheetTab } from "@/selection/state";

import { useNotebookDom } from "@/notebook/notebook-dom-context";

type SheetFocus = {
  open: boolean;
  historyKey: string | null;
};

export function useSheetFocus(
  dockRef: RefObject<HTMLElement | null>,
  open: boolean,
  sheetTab: RequestSheetTab,
  focusedHistoryKey: string | null,
): void {
  const dom = useNotebookDom();
  const sheetFocusRef = useRef<SheetFocus>({ open: false, historyKey: null });

  useLayoutEffect(() => {
    const previous = sheetFocusRef.current;
    const shouldFocus =
      open &&
      (!previous.open || (focusedHistoryKey !== null && focusedHistoryKey !== previous.historyKey));
    sheetFocusRef.current = { open, historyKey: focusedHistoryKey };
    if (!shouldFocus) return;
    const dock = dockRef.current;
    const target =
      sheetTab === "history"
        ? focusedHistoryKey === null
          ? dock?.querySelector<HTMLElement>("#marimo-lens-history-tab")
          : (dock?.querySelector<HTMLElement>(
              `[data-marimo-lens-history-key="${dom.window.CSS.escape(focusedHistoryKey)}"] [data-marimo-lens-history-summary]`,
            ) ?? dock?.querySelector<HTMLElement>("#marimo-lens-history-tab"))
        : (dock?.querySelector<HTMLElement>('[data-marimo-lens-requests] [aria-current="true"]') ??
          dock?.querySelector<HTMLElement>(
            "[data-marimo-lens-requests] [data-marimo-lens-selection-summary]",
          ) ??
          dock?.querySelector<HTMLElement>("#marimo-lens-open-tab"));
    target?.focus();
  }, [dockRef, dom, focusedHistoryKey, open, sheetTab]);
}
