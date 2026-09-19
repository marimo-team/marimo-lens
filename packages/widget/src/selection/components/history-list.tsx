import type { AddressedSelection } from "@marimo-lens/protocol";

import * as stylex from "@stylexjs/stylex";
import { Bot, ChevronDown, LoaderCircle, RotateCcw, UserRound } from "lucide-react";

import { SelectionKindMark } from "@/selection/components/selection-kind-mark";
import { selectionTitle } from "@/selection/selection-description";
import { buttonStyles, ui } from "@/styles/primitives";

import { historyStyles } from "./history-list.styles";
import { historyDisclosureMarker } from "./selection-markers.stylex";
import { sheetStyles } from "./selection-sheet.styles";

const addressedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const addressedDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

type HistoryListProps = {
  history: AddressedSelection[];
  openSelectionIds: ReadonlySet<string>;
  busySelectionIds: ReadonlySet<string>;
  onReopen: (receipt: AddressedSelection) => void;
};

export function HistoryList({
  history,
  openSelectionIds,
  busySelectionIds,
  onReopen,
}: HistoryListProps) {
  if (history.length === 0) {
    return <p {...stylex.props(sheetStyles.empty)}>Addressed selections appear here.</p>;
  }

  return (
    <ol {...stylex.props(historyStyles.list)}>
      {[...history].reverse().map((receipt) => {
        const busy = busySelectionIds.has(receipt.selectionId);
        const open = openSelectionIds.has(receipt.selectionId);
        return (
          <li
            key={`${receipt.selectionId}:${receipt.resolutionRevision}`}
            {...stylex.props(historyStyles.item)}
            data-marimo-lens-history-revision={receipt.resolutionRevision}
          >
            <details
              {...stylex.props(historyDisclosureMarker, historyStyles.disclosure)}
              data-marimo-lens-history-disclosure
            >
              <summary {...stylex.props(historyStyles.row)} data-marimo-lens-history-summary>
                <span {...stylex.props(ui.label, ui.borderless)}>{receipt.label}</span>
                <span
                  {...stylex.props(historyStyles.target)}
                  data-marimo-lens-history-target
                  title={selectionTitle(receipt)}
                >
                  <span {...stylex.props(ui.mono)}>{receipt.description.label}</span>
                  <SelectionKindMark kind={receipt.anchor.kind} />
                </span>
                <time
                  {...stylex.props(historyStyles.date)}
                  dateTime={receipt.addressedAt}
                  title={`Addressed ${formatAddressedAt(receipt.addressedAt)}`}
                >
                  {formatAddressedDate(receipt.addressedAt)}
                </time>
                <ChevronDown
                  {...stylex.props(historyStyles.chevron)}
                  size={14}
                  aria-hidden="true"
                />
              </summary>
              <div {...stylex.props(historyStyles.details)} data-marimo-lens-history-details>
                {receipt.note ? (
                  <div {...stylex.props(historyStyles.detailRow)}>
                    <span
                      {...stylex.props(historyStyles.author)}
                      aria-label="Request"
                      title="Request"
                    >
                      <UserRound size={14} aria-hidden="true" />
                    </span>
                    <p {...stylex.props(historyStyles.detailText)}>{receipt.note}</p>
                  </div>
                ) : null}
                {receipt.summary ? (
                  <div {...stylex.props(historyStyles.detailRow)}>
                    <span
                      {...stylex.props(historyStyles.author)}
                      aria-label="Addressed"
                      title="Addressed"
                    >
                      <Bot size={14} aria-hidden="true" />
                    </span>
                    <p {...stylex.props(historyStyles.detailText)}>{receipt.summary}</p>
                  </div>
                ) : null}
                <time {...stylex.props(historyStyles.addressedAt)} dateTime={receipt.addressedAt}>
                  Addressed {formatAddressedAt(receipt.addressedAt)}
                </time>
              </div>
            </details>
            <button
              {...stylex.props(...buttonStyles, historyStyles.reopen)}
              data-marimo-lens-history-reopen
              type="button"
              disabled={busy || open}
              onClick={() => onReopen(receipt)}
              aria-label={open ? `${receipt.label} is open` : `Reopen ${receipt.label}`}
            >
              {busy ? (
                <LoaderCircle {...stylex.props(ui.spin)} size={14} aria-hidden="true" />
              ) : open ? null : (
                <RotateCcw size={14} aria-hidden="true" />
              )}
              {busy ? "Reopening…" : open ? "Open" : "Reopen"}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function formatAddressedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return addressedAtFormatter.format(date);
}

function formatAddressedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return addressedDateFormatter.format(date);
}
