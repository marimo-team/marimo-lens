import type { KeyboardEvent, ReactNode } from "react";

import * as stylex from "@stylexjs/stylex";
import { LoaderCircle, MoreHorizontal, Trash2, X } from "lucide-react";

import type { RequestSheetTab } from "@/selection/state";

import { useLens, type LensState } from "@/context/lens-context";
import { HistoryList } from "@/history/history-list";
import { iconButtonStyles, ui } from "@/styles/primitives";

import { sheetStyles } from "./request-sheet.styles";
import { SelectionList } from "./selection-list";

/** Count the open requests: the open selections. */
export function openRequestCount(state: LensState): number {
  return state.selections.length;
}

/** The requests sheet: open selections and the addressed selections in History. */
export function RequestSheet({ notice, onClose }: { notice: ReactNode; onClose: () => void }) {
  const { state } = useLens();
  return (
    <section
      id="marimo-lens-selection-list"
      {...stylex.props(sheetStyles.sheet)}
      data-marimo-lens-selection-list
      data-marimo-lens-ui
      aria-labelledby="marimo-lens-selection-list-title"
    >
      <header {...stylex.props(sheetStyles.header)}>
        <div {...stylex.props(sheetStyles.identity)}>
          <h2 {...stylex.props(sheetStyles.title)} id="marimo-lens-selection-list-title">
            Selections
          </h2>
        </div>
        <div {...stylex.props(sheetStyles.actions)}>
          {state.history.length > 0 ? <HistoryMenu /> : null}
          <button
            {...stylex.props(...iconButtonStyles)}
            type="button"
            onClick={onClose}
            aria-label="Close selections"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <SheetTabs />
      {notice ? (
        <div {...stylex.props(sheetStyles.notice)} data-marimo-lens-sheet-notice>
          {notice}
        </div>
      ) : null}
      <div
        id="marimo-lens-open-panel"
        {...stylex.props(sheetStyles.panel)}
        role="tabpanel"
        aria-labelledby="marimo-lens-open-tab"
        hidden={state.sheet.tab !== "open"}
      >
        <OpenPanel />
      </div>
      <div
        id="marimo-lens-history-panel"
        {...stylex.props(sheetStyles.panel)}
        role="tabpanel"
        aria-labelledby="marimo-lens-history-tab"
        hidden={state.sheet.tab !== "history"}
      >
        <HistoryList />
      </div>
    </section>
  );
}

function HistoryMenu() {
  const { state, actions } = useLens();
  const clearing = state.historyClearPending;
  return (
    <details {...stylex.props(sheetStyles.overflow)}>
      <summary
        {...stylex.props(...iconButtonStyles, sheetStyles.overflowSummary)}
        aria-label="Selection options"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </summary>
      <div {...stylex.props(sheetStyles.overflowMenu)}>
        <button
          {...stylex.props(sheetStyles.overflowAction, sheetStyles.overflowDanger)}
          type="button"
          disabled={clearing || state.busySelectionIds.size > 0}
          onClick={actions.clearHistory}
        >
          {clearing ? (
            <LoaderCircle {...stylex.props(ui.spin)} size={14} aria-hidden="true" />
          ) : (
            <Trash2 size={14} aria-hidden="true" />
          )}
          {clearing ? "Clearing…" : "Clear history"}
        </button>
      </div>
    </details>
  );
}

function SheetTabs() {
  const { state } = useLens();
  return (
    <div {...stylex.props(sheetStyles.tabs)} role="tablist" aria-label="Selection status">
      <SheetTab tab="open" label="Open" count={openRequestCount(state)} />
      <SheetTab tab="history" label="History" count={state.history.length} />
    </div>
  );
}

function SheetTab({ tab, label, count }: { tab: RequestSheetTab; label: string; count: number }) {
  const { state, actions } = useLens();
  const selected = state.sheet.tab === tab;
  // Arrow keys move between the two tabs, as a tablist does.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: RequestSheetTab = tab === "open" ? "history" : "open";
    if (!tabAvailable(state, next)) return;
    actions.setSheetTab(next);
    event.currentTarget
      .closest('[role="tablist"]')
      ?.querySelector<HTMLButtonElement>(`#marimo-lens-${next}-tab`)
      ?.focus();
  };
  return (
    <button
      id={`marimo-lens-${tab}-tab`}
      {...stylex.props(sheetStyles.tab, selected && sheetStyles.tabSelected)}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`marimo-lens-${tab}-panel`}
      tabIndex={selected ? 0 : -1}
      disabled={!tabAvailable(state, tab)}
      onClick={() => actions.setSheetTab(tab)}
      onKeyDown={onKeyDown}
    >
      {label} <span {...stylex.props(sheetStyles.tabCount)}>{count}</span>
    </button>
  );
}

function OpenPanel() {
  const { state } = useLens();
  if (openRequestCount(state) === 0) {
    return <p {...stylex.props(ui.empty)}>No open selections.</p>;
  }
  return <SelectionList />;
}

function tabAvailable(state: LensState, tab: RequestSheetTab): boolean {
  return tab === "open" ? openRequestCount(state) > 0 : state.history.length > 0;
}
