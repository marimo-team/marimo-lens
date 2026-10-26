import type { HistoryChange, HistoryEntry } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { MessageSquare } from "lucide-react";

import { requestStanding, type RecordIndex } from "@/context/record-index";
import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { ui } from "@/styles/primitives";
import {
  CHANGE_STATUS_TEXT,
  ChangeStatusLabel,
  ChangeStatusMark,
} from "@/ui/components/change-status";
import { formatExactTime, formatWhen } from "@/ui/relative-time";

import { recordStyles } from "./record.styles";

/** Summarize whether a request's changes still hold. */
function RequestStanding({ entry }: { entry: HistoryEntry }) {
  const standing = requestStanding(entry);
  switch (standing.kind) {
    case "no_changes":
      return <span {...stylex.props(recordStyles.when)}>No cell changes</span>;
    case "in_force":
    case "unknown":
      return <ChangeStatusLabel status={standing.kind} />;
    case "undone":
      return (
        <ChangeStatusLabel status="undone">
          {standing.undone === standing.total
            ? undefined
            : `${standing.undone} of ${standing.total} undone`}
        </ChangeStatusLabel>
      );
  }
}

function ResolvedWhen({ resolvedAt, now }: { resolvedAt: string; now: number }) {
  return (
    <time
      {...stylex.props(recordStyles.when)}
      dateTime={resolvedAt}
      title={`Resolved ${formatExactTime(resolvedAt)}`}
    >
      {formatWhen(resolvedAt, now)}
    </time>
  );
}

export function ChangedCell({ change, record }: { change: HistoryChange; record: RecordIndex }) {
  const name = record.changedCellName(change);
  return (
    <span {...stylex.props(recordStyles.cell)} title={change.cellId ?? name}>
      <ChangeStatusMark status={change.status} />
      <span {...stylex.props(recordStyles.cellName)}>{name}</span>
      <span {...stylex.props(ui.visuallyHidden)}>
        , {CHANGE_STATUS_TEXT[change.status].toLowerCase()}
      </span>
    </span>
  );
}

/** The cells a request changed, each with its own status, and who undid them. */
function ChangedCells({ entry, record }: { entry: HistoryEntry; record: RecordIndex }) {
  if (entry.changes.length === 0) return null;
  const undoers = [
    ...new Set(entry.changes.flatMap(({ undoneBy }) => (undoneBy === undefined ? [] : [undoneBy]))),
  ];
  return (
    <span {...stylex.props(recordStyles.cells)} data-marimo-lens-changed-cells>
      {keyedChanges(entry.changes).map(([key, change]) => (
        <ChangedCell key={key} change={change} record={record} />
      ))}
      {undoers.length > 0 ? (
        <span>
          undone by{" "}
          <span {...stylex.props(recordStyles.undoer)}>
            {undoers.map((undoer) => record.requestName(undoer)).join(", ")}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Name a request by its selection label, or mark it as asked in chat. */
export function RequestChip({ entry }: { entry: HistoryEntry }) {
  return entry.channel === "chat" ? (
    <span
      {...stylex.props(ui.label, ui.borderless, recordStyles.chip)}
      title="Asked in chat. The note is the agent's copy of the message."
    >
      <MessageSquare size={12} aria-label="Chat request" />
    </span>
  ) : (
    <span {...stylex.props(ui.label, ui.borderless, recordStyles.chip)}>{entry.label}</span>
  );
}

/** A request as the record keeps it: whether it holds, when, what it asked, and its cells. */
export function RequestSummary({
  entry,
  record,
  now,
}: {
  entry: HistoryEntry;
  record: RecordIndex;
  now: number;
}) {
  return (
    <span {...stylex.props(recordStyles.summary)}>
      <span {...stylex.props(recordStyles.head)}>
        <RequestStanding entry={entry} />
        <ResolvedWhen resolvedAt={entry.resolvedAt} now={now} />
        <RequestTarget entry={entry} />
      </span>
      <RequestQuote entry={entry} />
      <ChangedCells entry={entry} record={record} />
    </span>
  );
}

function RequestQuote({ entry }: { entry: HistoryEntry }) {
  return (
    <span
      {...stylex.props(recordStyles.quote, !entry.note && recordStyles.quoteEmpty)}
      data-marimo-lens-history-note
      title={entry.note}
    >
      {entry.note || "No note"}
    </span>
  );
}

/** What a selection request pointed at, as the selection described it. */
function RequestTarget({ entry }: { entry: HistoryEntry }) {
  if (!entry.selection) return null;
  const { description, anchor } = entry.selection;
  return (
    <span {...stylex.props(recordStyles.target)} data-marimo-lens-history-target>
      <span {...stylex.props(recordStyles.targetLabel)} title={description.label}>
        {description.label}
      </span>
      <SelectionKindMark kind={anchor.kind} noLeadingMargin />
    </span>
  );
}

/** The statements an undone change added that its cell no longer holds. */
export function LostStatements({ change, cellName }: { change: HistoryChange; cellName: string }) {
  if (!change.missing) return null;
  return (
    <div {...stylex.props(recordStyles.lost)} data-marimo-lens-lost-statements>
      <span>No longer in {cellName}:</span>
      {keyed(change.missing).map(([key, statement]) => (
        <code key={key} {...stylex.props(recordStyles.lostCode)} title={statement}>
          {statement}
        </code>
      ))}
    </div>
  );
}

/**
 * Key changes by the cell they name, so a row keeps its element when its
 * status changes. A deleted cell has no ID, so repeats take an occurrence count.
 */
export function keyedChanges(changes: readonly HistoryChange[]): Array<[string, HistoryChange]> {
  return keyed(changes, (change) => change.cellId ?? `deleted:${change.name ?? ""}`);
}

/** Key values by text, counting repeats that cut to the same text. */
function keyed<T>(values: readonly T[], text: (value: T) => string = String): Array<[string, T]> {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const base = text(value);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return [count === 0 ? base : `${base}:${count}`, value];
  });
}
