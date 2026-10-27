import type {
  HistoryChange,
  HistoryEntry,
  HistoryState,
  SelectionResolvedEvent,
} from "@marimo-lens/protocol";

/** Identify one resolution: a reopened selection resolves again under its ID. */
export function historyKey(requestId: string, resolvedAt: string): string {
  return `${requestId}@${resolvedAt}`;
}

/** Return whether History has entries or a record failure to show. */
export function historyShows(history: HistoryState | null): boolean {
  return history !== null && (history.entries.length > 0 || history.record.status === "failed");
}

/** Whether a request's changes still hold, summarized over all of them. */
export type RequestStanding =
  | { kind: "no_changes" }
  | { kind: "in_force" }
  | { kind: "undone"; undone: number; total: number }
  | { kind: "unknown" };

export function requestStanding(entry: HistoryEntry): RequestStanding {
  const total = entry.changes.length;
  if (total === 0) return { kind: "no_changes" };
  let undone = 0;
  let unknown = 0;
  for (const change of entry.changes) {
    if (change.status === "undone") undone += 1;
    else if (change.status === "unknown") unknown += 1;
  }
  if (undone > 0) return { kind: "undone", undone, total };
  return unknown > 0 ? { kind: "unknown" } : { kind: "in_force" };
}

/** Lookups over one History value, shared by every view of the record. */
export type RecordIndex = {
  /** Newest first. */
  entries: readonly HistoryEntry[];
  /** The requests that shaped an open selection, undone ones first, then newest first. */
  shaping: (selectionId: string) => HistoryEntry[];
  /** The resolutions a receipt announces. */
  resolution: (event: SelectionResolvedEvent) => HistoryEntry[];
  /** Name the cell a change touched, including a deleted or unlocated one. */
  changedCellName: (change: HistoryChange) => string;
  /** Name the request in "undone by", from its label or the start of its note. */
  requestName: (requestId: string) => string;
};

export function indexRecord(history: HistoryState | null): RecordIndex {
  const entries = history ? history.entries.toReversed() : [];
  const byKey = new Map(entries.map((entry) => [historyKey(entry.id, entry.resolvedAt), entry]));
  const latestById = new Map<string, HistoryEntry>();
  for (const entry of entries) {
    if (!latestById.has(entry.id)) latestById.set(entry.id, entry);
  }
  const cells = new Map((history?.cells ?? []).map((cell) => [cell.id, cell]));

  const cellName = (cellId: string): string | null => {
    const cell = cells.get(cellId);
    if (!cell) return null;
    if (cell.name) return cell.name;
    if (cell.defines.length === 0) return null;
    const shown = cell.defines.slice(0, 3).join(", ");
    return cell.defines.length > 3 ? `${shown}, …` : shown;
  };

  const shaping = new Map<string, HistoryEntry[]>();

  return {
    entries,
    shaping: (selectionId) => {
      let found = shaping.get(selectionId);
      if (!found) {
        const shaped = entries.filter((entry) => entry.shaped?.includes(selectionId));
        found = [
          ...shaped.filter((entry) => requestStanding(entry).kind === "undone"),
          ...shaped.filter((entry) => requestStanding(entry).kind !== "undone"),
        ];
        shaping.set(selectionId, found);
      }
      return found;
    },
    resolution: (event) =>
      event.payload.selections.flatMap(({ selectionId }) => {
        const entry = byKey.get(historyKey(selectionId, event.payload.resolvedAt));
        return entry ? [entry] : [];
      }),
    changedCellName: (change) => {
      if (!change.cellId) return change.status === "unknown" ? "Cell not found" : "Deleted cell";
      return cellName(change.cellId) ?? change.name ?? "Unnamed cell";
    },
    requestName: (requestId) => {
      if (requestId === "unrecorded") return "an edit made outside Lens";
      const entry = latestById.get(requestId);
      if (!entry) return "a later request";
      if (entry.label) return entry.label;
      return entry.note ? `“${shorten(entry.note, 40)}”` : "a chat request";
    },
  };
}

/** Cut text to at most `length` characters at a word boundary, ending in "…". */
function shorten(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
