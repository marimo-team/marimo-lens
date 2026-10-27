import type { HistoryChange, SelectionResolvedEvent } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";

import type { RecordIndex } from "@/context/record-index";

import { useLens } from "@/context/lens-context";
import { ChangedCell, keyedChanges } from "@/history/record-parts";
import { useNotebookDom } from "@/notebook/notebook-dom-context";
import { LiveRegion } from "@/ui/components/lens-status";

import { transientStyles } from "./transient.styles";

/**
 * The receipt in the dock's panel. Opening it expands a collapsed dock to show
 * History, and dismissing it hands focus inside the dock back to its main control.
 */
export function ResolutionReceipt({
  onReveal,
  onRefocus,
}: {
  onReveal: () => void;
  onRefocus: () => void;
}) {
  const { state } = useLens();
  if (!state.receipt) return null;
  return (
    <Receipt
      key={state.receipt.revision}
      event={state.receipt}
      onReveal={onReveal}
      onRefocus={onRefocus}
    />
  );
}

/** Announce that the agent returned selections for review, and what it changed. */
function Receipt({
  event,
  onReveal,
  onRefocus,
}: {
  event: SelectionResolvedEvent;
  onReveal: () => void;
  onRefocus: () => void;
}) {
  const { state, actions } = useLens();
  const dom = useNotebookDom();
  const { selections } = event.payload;
  const label = selections.length === 1 ? selections[0]!.label : `${selections.length} selections`;
  const interaction = useReceiptInteraction(event, actions.setReceiptInteraction);
  const changes = resolvedChanges(event, state.record);
  // A Lens without History has no resolution to open, so its receipt dismisses.
  const openable = state.history !== null;
  // Inside the open sheet, History is one tab away, so the receipt offers no link.
  const viewable = openable && !state.sheet.open;
  const onClick = () => {
    if (openable) {
      onReveal();
      actions.openResolution(event);
      return;
    }
    if (dom.activeElement?.closest("[data-marimo-lens-dock]")) onRefocus();
    actions.dismissReceipt(event);
  };

  return (
    <button
      {...stylex.props(transientStyles.notification, transientStyles.receipt)}
      type="button"
      data-marimo-lens-resolution-receipt
      data-selection-id={selections.length === 1 ? selections[0]!.selectionId : undefined}
      data-selection-count={selections.length}
      data-revision={event.revision}
      data-marimo-lens-ui
      onClick={onClick}
      {...interaction}
      aria-label={openable ? `Open history for ${label}` : `Dismiss receipt for ${label}`}
    >
      <Check
        {...stylex.props(transientStyles.notificationIcon, transientStyles.receiptIcon)}
        size={14}
        strokeWidth={2}
        aria-hidden="true"
      />
      <span {...stylex.props(transientStyles.receiptLabel)}>{label}</span>
      <span {...stylex.props(transientStyles.receiptStatus)}>Addressed</span>
      {event.payload.summary ? (
        <span {...stylex.props(transientStyles.receiptSummary)}>{event.payload.summary}</span>
      ) : null}
      {changes.length > 0 || viewable ? (
        <span {...stylex.props(transientStyles.receiptChanges)} data-marimo-lens-receipt-changes>
          {changes.length > 0 ? (
            <span {...stylex.props(transientStyles.receiptCells)}>
              Changed
              {keyedChanges(changes).map(([key, change]) => (
                <ChangedCell key={key} change={change} record={state.record} />
              ))}
            </span>
          ) : null}
          {viewable ? (
            <span {...stylex.props(transientStyles.receiptLink)} aria-hidden="true">
              View in History
              <ChevronRight size={12} />
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** Tell a screen reader that the agent addressed selections, and what it changed. */
export function ReceiptAnnouncement({ event }: { event: SelectionResolvedEvent | null }) {
  const { state } = useLens();
  return (
    <LiveRegion data-marimo-lens-receipt-status>
      {event ? receiptAnnouncement(event, state.record) : null}
    </LiveRegion>
  );
}

function receiptAnnouncement(event: SelectionResolvedEvent, record: RecordIndex): string {
  const resolved = event.payload.selections;
  const parts = [
    resolved.length === 1
      ? `${resolved[0]!.label} addressed.`
      : `${resolved.length} selections addressed.`,
  ];
  if (event.payload.summary) parts.push(event.payload.summary);
  const cells = resolvedChanges(event, record).map((change) => record.changedCellName(change));
  if (cells.length > 0) parts.push(`Changed ${cells.join(", ")}.`);
  return parts.join(" ");
}

/** The cells a resolution changed, once each, as History records them. */
function resolvedChanges(event: SelectionResolvedEvent, record: RecordIndex): HistoryChange[] {
  const byCell = new Map<string, HistoryChange>();
  for (const entry of record.resolution(event)) {
    for (const change of entry.changes) {
      byCell.set(change.cellId ?? record.changedCellName(change), change);
    }
  }
  return [...byCell.values()];
}

/**
 * Report while the pointer or focus rests on the receipt, so it stays up for
 * reading, and report the end when the receipt goes away.
 */
function useReceiptInteraction(
  event: SelectionResolvedEvent,
  report: (event: SelectionResolvedEvent, active: boolean) => void,
) {
  const interaction = useRef({ focused: false, hovered: false });
  const update = (kind: "focused" | "hovered", active: boolean) => {
    interaction.current[kind] = active;
    report(event, interaction.current.focused || interaction.current.hovered);
  };
  useEffect(() => () => report(event, false), [event, report]);
  return {
    onPointerEnter: () => update("hovered", true),
    onPointerLeave: () => update("hovered", false),
    onFocus: () => update("focused", true),
    onBlur: () => update("focused", false),
  };
}
