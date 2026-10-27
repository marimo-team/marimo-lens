import type { KeyboardEvent, ReactNode } from "react";

import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";

import type { RequestSheetTab } from "@/selection/state";

import { useLens, type LensState } from "@/context/lens-context";
import { historyShows } from "@/context/record-index";
import { HistoryList } from "@/history/history-list";
import { iconButtonStyles, ui } from "@/styles/primitives";

import { OpenChats } from "./open-chats";
import { sheetStyles } from "./request-sheet.styles";
import { SelectionList } from "./selection-list";

/** Count the open requests: selections and chat requests. */
export function openRequestCount(state: LensState): number {
  return state.selections.length + state.chats.length;
}

/** The requests sheet: open selections and chat requests, and the record's History. */
export function RequestSheet({ notice, onClose }: { notice: ReactNode; onClose: () => void }) {
  const { state } = useLens();
  return (
    <section
      id="marimo-lens-requests"
      {...stylex.props(sheetStyles.sheet)}
      data-marimo-lens-requests
      data-marimo-lens-ui
      aria-labelledby="marimo-lens-requests-title"
    >
      <header {...stylex.props(sheetStyles.header)}>
        <h2 {...stylex.props(sheetStyles.title)} id="marimo-lens-requests-title">
          Requests
        </h2>
        <button
          {...stylex.props(...iconButtonStyles)}
          type="button"
          onClick={onClose}
          aria-label="Close requests"
        >
          <X size={16} aria-hidden="true" />
        </button>
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
      {state.history ? (
        <div
          id="marimo-lens-history-panel"
          {...stylex.props(sheetStyles.panel)}
          role="tabpanel"
          aria-labelledby="marimo-lens-history-tab"
          hidden={state.sheet.tab !== "history"}
        >
          <HistoryList history={state.history} />
        </div>
      ) : null}
    </section>
  );
}

function SheetTabs() {
  const { state } = useLens();
  return (
    <div {...stylex.props(sheetStyles.tabs)} role="tablist" aria-label="Request status">
      <SheetTab tab="open" label="Open" count={openRequestCount(state)} />
      {state.history ? (
        <SheetTab tab="history" label="History" count={state.history.entries.length} />
      ) : null}
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
    return <p {...stylex.props(ui.empty)}>No open requests.</p>;
  }
  return (
    <>
      <OpenChats />
      {state.selections.length > 0 ? <SelectionList /> : null}
    </>
  );
}

function tabAvailable(state: LensState, tab: RequestSheetTab): boolean {
  return tab === "open" ? openRequestCount(state) > 0 : historyShows(state.history);
}
