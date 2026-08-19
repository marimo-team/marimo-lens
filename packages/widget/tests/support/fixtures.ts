import type { AddressedSelection, Selection } from "@marimo-lens/protocol";

export function selectionFixture(overrides: Partial<Selection> = {}): Selection {
  return {
    id: "selection-1",
    label: "S1",
    note: "Align this label",
    target: { kind: "notebook", cellIds: ["cell-1"] },
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
    target: { kind: "notebook", cellIds: ["cell-1"] },
    createdAt: "2026-07-14T10:00:00Z",
    addressedAt: "2026-07-23T08:00:00Z",
    anchor: { kind: "point", x: 0.25, y: 0.5 },
    summary: "Updated the label and verified the rendered output.",
    resolutionRevision: 4,
    ...overrides,
  };
}
