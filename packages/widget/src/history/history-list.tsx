import type { HistoryChange, HistoryEntry, HistoryState } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { Bot, ChevronDown, LoaderCircle, LocateFixed, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { RecordIndex } from "@/context/record-index";

import { useLens } from "@/context/lens-context";
import { historyKey } from "@/context/record-index";
import { buttonStyles, ui } from "@/styles/primitives";
import { ChangeStatusLabel } from "@/ui/components/change-status";
import { formatExactTime } from "@/ui/relative-time";
import { useNow } from "@/ui/use-now";

import { historyDisclosureMarker } from "../selection/components/selection-markers.stylex";
import { HistoryImage } from "./history-image";
import { historyStyles } from "./history-list.styles";
import { LostStatements, RequestChip, RequestSummary, keyedChanges } from "./record-parts";

export function HistoryList({ history }: { history: HistoryState }) {
  const { state } = useLens();
  const current = state.selections.find(({ id }) => id === state.currentSelectionId) ?? null;
  const filtered = state.sheet.shapedOnly && current !== null;
  const entries = filtered ? state.record.shaping(current.id) : state.record.entries;
  const older = history.total - history.entries.length;
  const now = useNow();
  return (
    <div {...stylex.props(historyStyles.panel)}>
      {current ? <ShapedFilter label={current.label} /> : null}
      {entries.length === 0 ? (
        <p {...stylex.props(ui.empty)}>
          {filtered
            ? `No earlier request changed what ${current.label} shows.`
            : "Resolved requests appear here."}
        </p>
      ) : (
        <ol {...stylex.props(historyStyles.list)}>
          {entries.map((entry) => (
            <HistoryItem key={historyKey(entry.id, entry.resolvedAt)} entry={entry} now={now} />
          ))}
        </ol>
      )}
      <p {...stylex.props(historyStyles.footer)} data-marimo-lens-history-record>
        {recordText(history)}
        {older > 0 ? ` ${older} older ${older === 1 ? "request is" : "requests are"} in it.` : ""}
      </p>
    </div>
  );
}

function ShapedFilter({ label }: { label: string }) {
  const { state, actions } = useLens();
  return (
    <label {...stylex.props(historyStyles.filter)}>
      <input
        type="checkbox"
        checked={state.sheet.shapedOnly}
        onChange={(event) => actions.setShapedOnly(event.currentTarget.checked)}
      />
      Only requests that changed what {label} shows
    </label>
  );
}

function HistoryItem({ entry, now }: { entry: HistoryEntry; now: number }) {
  // The image loads only while its entry is expanded.
  const [expanded, setExpanded] = useState(false);
  const { state, meta } = useLens();
  return (
    <li
      {...stylex.props(historyStyles.item)}
      data-marimo-lens-history-key={historyKey(entry.id, entry.resolvedAt)}
      data-marimo-lens-history-channel={entry.channel}
    >
      <details
        {...stylex.props(historyDisclosureMarker, historyStyles.disclosure)}
        data-marimo-lens-history-disclosure
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary
          {...stylex.props(
            historyStyles.row,
            entry.selection ? historyStyles.rowWithReopen : historyStyles.rowPlain,
          )}
          data-marimo-lens-history-summary
        >
          <RequestChip entry={entry} />
          <RequestSummary entry={entry} record={state.record} now={now} />
          <ChevronDown {...stylex.props(historyStyles.chevron)} size={14} aria-hidden="true" />
        </summary>
        <HistoryDetails entry={entry}>
          {expanded && entry.image ? (
            <HistoryImage
              image={entry.image}
              title={entry.label ?? "Chat"}
              load={meta.loadHistoryImage}
            />
          ) : null}
        </HistoryDetails>
      </details>
      {entry.selection ? <ReopenButton entry={entry} /> : null}
    </li>
  );
}

function HistoryDetails({ entry, children }: { entry: HistoryEntry; children: ReactNode }) {
  const { state, actions } = useLens();
  const revealable = entry.cellIds.length > 0 || entry.changes.some(({ cellId }) => cellId);
  return (
    <div {...stylex.props(historyStyles.details)} data-marimo-lens-history-details>
      {children}
      {entry.summary ? (
        <div {...stylex.props(historyStyles.detailRow)}>
          <span {...stylex.props(historyStyles.author)} title="Resolved by the agent">
            <Bot size={14} aria-label="Resolved by the agent" />
          </span>
          <p {...stylex.props(historyStyles.detailText)}>{entry.summary}</p>
        </div>
      ) : null}
      {entry.changes.length > 0 ? (
        <ul {...stylex.props(historyStyles.changes)} aria-label="Changed cells">
          {keyedChanges(entry.changes).map(([key, change]) => (
            <ChangeLine key={key} change={change} record={state.record} />
          ))}
        </ul>
      ) : null}
      <div {...stylex.props(historyStyles.detailActions)}>
        <time {...stylex.props(historyStyles.meta)} dateTime={entry.resolvedAt}>
          Resolved {formatExactTime(entry.resolvedAt)}
        </time>
        <button
          {...stylex.props(...buttonStyles, historyStyles.action)}
          type="button"
          data-marimo-lens-history-reveal
          disabled={!revealable}
          onClick={() => actions.revealCells(entry)}
        >
          <LocateFixed size={14} aria-hidden="true" />
          Show cells
        </button>
      </div>
    </div>
  );
}

function ChangeLine({ change, record }: { change: HistoryChange; record: RecordIndex }) {
  const cellName = record.changedCellName(change);
  return (
    <li {...stylex.props(historyStyles.change)} data-marimo-lens-history-change={change.status}>
      <span {...stylex.props(historyStyles.changeHead)}>
        <span {...stylex.props(ui.mono, historyStyles.cell)} title={change.cellId}>
          {cellName}
        </span>
        <ChangeStatusLabel status={change.status}>
          {change.status === "undone" && change.undoneBy !== undefined
            ? `Undone by ${record.requestName(change.undoneBy)}`
            : undefined}
        </ChangeStatusLabel>
      </span>
      <LostStatements change={change} cellName={cellName} />
    </li>
  );
}

function ReopenButton({ entry }: { entry: HistoryEntry }) {
  const { state, actions } = useLens();
  const busy = state.busySelectionIds.has(entry.id);
  const open = state.selections.some(({ id }) => id === entry.id);
  return (
    <button
      {...stylex.props(...buttonStyles, historyStyles.reopen)}
      data-marimo-lens-history-reopen
      type="button"
      disabled={busy || open}
      onClick={() => actions.reopen(entry)}
      aria-label={open ? `${entry.label} is open` : `Reopen ${entry.label}`}
    >
      {busy ? (
        <LoaderCircle {...stylex.props(ui.spin)} size={14} aria-hidden="true" />
      ) : open ? null : (
        <RotateCcw size={14} aria-hidden="true" />
      )}
      {busy ? "Reopening…" : open ? "Open" : "Reopen"}
    </button>
  );
}

function recordText(history: HistoryState): string {
  const { status, reason } = history.record;
  if (status === "saved") return "Kept in the notebook's record.";
  if (status === "unsaved") return "Not saved yet: the notebook has no file name.";
  if (status === "session") return "Kept until this notebook runtime restarts.";
  return `Not saved: ${reason ?? "the last write failed"}.`;
}
