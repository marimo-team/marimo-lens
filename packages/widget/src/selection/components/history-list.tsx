import type { AddressedSelection } from "@marimo-lens/protocol";

import { Bot, ChevronDown, LoaderCircle, RotateCcw, UserRound } from "lucide-react";

import { SelectionKindMark } from "@/selection/components/selection-kind-mark";

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
    return <p className="ml-selection-sheet__empty">Addressed selections appear here.</p>;
  }

  return (
    <ol className="ml-history-list">
      {[...history].reverse().map((receipt) => {
        const busy = busySelectionIds.has(receipt.selectionId);
        const open = openSelectionIds.has(receipt.selectionId);
        return (
          <li
            key={`${receipt.selectionId}:${receipt.resolutionRevision}`}
            className="ml-history-list__item"
            data-marimo-lens-history-revision={receipt.resolutionRevision}
          >
            <details className="ml-history-list__disclosure">
              <summary className="ml-history-list__row">
                <span className="ml-label">{receipt.label}</span>
                <span className="ml-history-list__target">
                  Cell <span className="ml-code">{receipt.outputCellId}</span>
                  <SelectionKindMark kind={receipt.anchor.kind} />
                </span>
                <time
                  className="ml-history-list__date"
                  dateTime={receipt.addressedAt}
                  title={`Addressed ${formatAddressedAt(receipt.addressedAt)}`}
                >
                  {formatAddressedDate(receipt.addressedAt)}
                </time>
                <ChevronDown className="ml-history-list__chevron" size={14} aria-hidden="true" />
              </summary>
              <div className="ml-history-list__details">
                {receipt.note ? (
                  <div>
                    <span className="ml-history-list__author" aria-label="Request" title="Request">
                      <UserRound size={14} aria-hidden="true" />
                    </span>
                    <p>{receipt.note}</p>
                  </div>
                ) : null}
                {receipt.summary ? (
                  <div>
                    <span
                      className="ml-history-list__author"
                      aria-label="Addressed"
                      title="Addressed"
                    >
                      <Bot size={14} aria-hidden="true" />
                    </span>
                    <p>{receipt.summary}</p>
                  </div>
                ) : null}
                <time dateTime={receipt.addressedAt}>
                  Addressed {formatAddressedAt(receipt.addressedAt)}
                </time>
              </div>
            </details>
            <button
              className="ml-button ml-history-list__reopen"
              type="button"
              disabled={busy || open}
              onClick={() => onReopen(receipt)}
              aria-label={open ? `${receipt.label} is open` : `Reopen ${receipt.label}`}
            >
              {busy ? (
                <LoaderCircle className="ml-spin" size={14} aria-hidden="true" />
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
