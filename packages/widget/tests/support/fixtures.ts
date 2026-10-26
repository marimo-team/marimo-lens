import type {
  HistoryEntry,
  HistoryState,
  ResolvedSelection,
  Selection,
  SelectionResolvedEvent,
} from "@marimo-lens/protocol";

import { WIDGET_TRANSPORT_VERSION } from "@marimo-lens/protocol";

import { documentIdentity } from "@/notebook/document-identity";

export function selectionFixture(overrides: Partial<Selection> = {}): Selection {
  return {
    id: "selection-1",
    label: "S1",
    note: "Align this label",
    description: { label: "Cell cell-1" },
    target: {
      kind: "notebook",
      cellIds: ["cell-1"],
      documentId: documentIdentity(document),
      documentPath: "/",
    },
    createdAt: "2026-07-14T10:00:00Z",
    anchor: { kind: "point", x: 0.25, y: 0.5 },
    snapshot: {
      status: "available",
      id: `image:${overrides.id ?? "selection-1"}`,
      mediaType: "image/png",
      width: 800,
      height: 600,
      sha256: "a".repeat(64),
      capturedAt: "2026-07-14T10:01:00Z",
    },
    ...overrides,
  };
}

export function resolvedSelectionFixture(
  selection: Selection = selectionFixture(),
): ResolvedSelection {
  return {
    selectionId: selection.id,
    label: selection.label,
    target: selection.target,
  };
}

type ResolvedEventOptions = {
  revision?: number;
  selections?: Selection[];
  resolvedAt?: string;
  summary?: string;
};

/** The event Python sends when `selections` resolve together. */
export function resolvedEventFixture({
  revision = 2,
  selections = [selectionFixture()],
  resolvedAt = "2026-07-23T08:00:00Z",
  summary,
}: ResolvedEventOptions = {}): SelectionResolvedEvent {
  const payload: SelectionResolvedEvent["payload"] = {
    selections: selections.map((selection) => resolvedSelectionFixture(selection)),
    resolvedAt,
  };
  if (summary) payload.summary = summary;
  return {
    protocol: "marimo-lens.event",
    version: WIDGET_TRANSPORT_VERSION,
    type: "selection.resolved",
    revision,
    payload,
  };
}

export function historyEntryFixture(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "selection-1",
    channel: "selection",
    label: "S1",
    note: "Align this label",
    summary: "Updated the label and verified the rendered output.",
    openedAt: "2026-07-23T07:58:00Z",
    resolvedAt: "2026-07-23T08:00:00Z",
    revision: 4,
    cellIds: ["cell-1"],
    changes: [],
    selection: {
      target: {
        kind: "notebook",
        cellIds: ["cell-1"],
        documentId: documentIdentity(document),
        documentPath: "/",
      },
      anchor: { kind: "point", x: 0.25, y: 0.5 },
      description: { label: "Cell cell-1" },
    },
    ...overrides,
  };
}

export function historyFixture(
  entries: HistoryEntry[] = [],
  overrides: Partial<HistoryState> = {},
): HistoryState {
  return {
    entries,
    total: entries.length,
    record: { status: "saved" },
    cells: [],
    ...overrides,
  };
}

/** A rendered marimo output for `cellId`, laid out at `rect` with no overflow. */
export function outputFixture(cellId = "cell-1", rect = new DOMRect(0, 0, 400, 240)): HTMLElement {
  const output = document.createElement("div");
  output.id = `output-${cellId}`;
  output.getBoundingClientRect = () => rect;
  Object.defineProperties(output, {
    scrollWidth: { configurable: true, value: rect.width },
    scrollHeight: { configurable: true, value: rect.height },
  });
  document.body.appendChild(output);
  return output;
}

/** A promise with its resolver, for a test that settles it at a chosen point. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
