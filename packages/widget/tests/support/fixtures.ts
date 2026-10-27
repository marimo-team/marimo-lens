import type {
  AddressedSelection,
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

export function addressedSelectionFixture(
  overrides: Partial<AddressedSelection> = {},
): AddressedSelection {
  return {
    selectionId: "selection-1",
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
    addressedAt: "2026-07-23T08:00:00Z",
    anchor: { kind: "point", x: 0.25, y: 0.5 },
    summary: "Updated the label and verified the rendered output.",
    resolutionRevision: 4,
    ...overrides,
  };
}

export function resolvedSelectionFixture(
  selection: Selection = selectionFixture(),
  resolutionRevision = 2,
): ResolvedSelection {
  return {
    selectionId: selection.id,
    label: selection.label,
    resolutionRevision,
  };
}

type ResolvedEventOptions = {
  revision?: number;
  selections?: Selection[];
  summary?: string;
};

/** The event Python sends when `selections` resolve together. */
export function resolvedEventFixture({
  revision = 2,
  selections = [selectionFixture()],
  summary,
}: ResolvedEventOptions = {}): SelectionResolvedEvent {
  const payload: SelectionResolvedEvent["payload"] = {
    selections: selections.map((selection) => resolvedSelectionFixture(selection, revision)),
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
