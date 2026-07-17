import { describe, expect, test } from "vite-plus/test";

import {
  ActivateSelectionCommandSchema,
  ExportContextCommandSchema,
  GetSnapshotCommandSchema,
  DeleteSelectionCommandSchema,
  LensStateSchema,
  PutSelectionCommandSchema,
  SelectionResolvedEventSchema,
  SelectionSchema,
  parseContract,
} from "@/contracts";

import { selectionFixture } from "./test-fixtures";

describe("selection contracts", () => {
  test("accepts empty notes and every snapshot lifecycle state", () => {
    const metadata = {
      id: "image:selection-1",
      mediaType: "image/png" as const,
      width: 800,
      height: 600,
      sha256: "a".repeat(64),
      capturedAt: "2026-07-14T10:01:00Z",
    };
    for (const snapshot of [
      { status: "pending" as const },
      { status: "available" as const, ...metadata },
      {
        status: "failed" as const,
        capturedAt: metadata.capturedAt,
        error: "Canvas blocked",
      },
      { status: "outdated" as const, ...metadata },
    ]) {
      expect(
        parseContract(SelectionSchema, selectionFixture({ note: "", snapshot }), "selection"),
      ).toMatchObject({ label: "S1", note: "", snapshot });
    }
  });

  test("accepts one current selection in canonical state", () => {
    expect(
      parseContract(
        LensStateSchema,
        {
          revision: 3,
          nextLabel: "S2",
          currentSelectionId: "selection-1",
          selections: [selectionFixture()],
        },
        "state",
      ),
    ).toMatchObject({
      revision: 3,
      nextLabel: "S2",
      currentSelectionId: "selection-1",
    });
  });

  test("rejects malformed labels, duplicate identity, and an unknown current selection", () => {
    expect(() =>
      parseContract(
        SelectionSchema,
        { ...selectionFixture(), label: "selection-one" },
        "selection",
      ),
    ).toThrow();
    expect(() =>
      parseContract(
        LensStateSchema,
        {
          revision: 3,
          nextLabel: "S2",
          currentSelectionId: "missing",
          selections: [selectionFixture(), selectionFixture()],
        },
        "state",
      ),
    ).toThrow();
  });

  test("requires positive rectangles contained by the output", () => {
    expect(() =>
      parseContract(
        SelectionSchema,
        selectionFixture({
          anchor: { kind: "rect", x: 0.8, y: 0.2, width: 0.3, height: 0.2 },
        }),
        "selection",
      ),
    ).toThrow("Selection rectangle extends beyond its output cell");
  });

  test("requires expected revisions on every mutation", () => {
    expect(() =>
      parseContract(
        PutSelectionCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 1,
          requestId: "request-1",
          type: "selection.put",
          payload: { selection: selectionFixture(), imageAction: "replace" },
        },
        "command",
      ),
    ).toThrow();
    expect(() =>
      parseContract(
        ActivateSelectionCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 1,
          requestId: "request-1",
          type: "selection.activate",
          payload: { selectionId: "selection-1" },
        },
        "command",
      ),
    ).toThrow();
    expect(() =>
      parseContract(
        DeleteSelectionCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 1,
          requestId: "request-1",
          type: "selection.delete",
          payload: { selectionId: "selection-1" },
        },
        "command",
      ),
    ).toThrow();
  });

  test("keeps read commands explicit and revision free", () => {
    expect(
      parseContract(
        ExportContextCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 1,
          requestId: "request-1",
          type: "context.export",
          payload: { format: "current" },
        },
        "command",
      ),
    ).toMatchObject({ payload: { format: "current" } });
    expect(
      parseContract(
        GetSnapshotCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 1,
          requestId: "request-2",
          type: "snapshot.get",
          payload: { selectionId: "selection-1" },
        },
        "command",
      ),
    ).toMatchObject({ payload: { selectionId: "selection-1" } });
  });

  test("keeps image actions aligned with snapshot status", () => {
    const command = (selection: ReturnType<typeof selectionFixture>, imageAction: string) => ({
      protocol: "marimo-lens.command",
      version: 1,
      requestId: "request-1",
      type: "selection.put",
      payload: { selection, imageAction, expectedRevision: 0 },
    });

    expect(() =>
      parseContract(PutSelectionCommandSchema, command(selectionFixture(), "clear"), "command"),
    ).toThrow("Snapshot status does not match imageAction");
    expect(() =>
      parseContract(
        PutSelectionCommandSchema,
        command(selectionFixture({ snapshot: { status: "pending" } }), "replace"),
        "command",
      ),
    ).toThrow("Snapshot status does not match imageAction");

    expect(
      parseContract(
        PutSelectionCommandSchema,
        command(selectionFixture({ snapshot: { status: "pending" } }), "clear"),
        "command",
      ),
    ).toMatchObject({ payload: { imageAction: "clear" } });
    expect(
      parseContract(PutSelectionCommandSchema, command(selectionFixture(), "replace"), "command"),
    ).toMatchObject({ payload: { imageAction: "replace" } });
  });

  test("accepts the strict selection resolution event", () => {
    const event = {
      protocol: "marimo-lens.event",
      version: 1,
      type: "selection.resolved",
      revision: 4,
      payload: {
        selectionId: "selection-1",
        label: "S1",
        summary: "Updated the chart cell.",
      },
    };

    expect(parseContract(SelectionResolvedEventSchema, event, "event")).toEqual(event);
    expect(() =>
      parseContract(
        SelectionResolvedEventSchema,
        { ...event, payload: { ...event.payload, summary: "" } },
        "event",
      ),
    ).toThrow();
    expect(() =>
      parseContract(
        SelectionResolvedEventSchema,
        { ...event, payload: { ...event.payload, summary: "😀".repeat(121) } },
        "event",
      ),
    ).toThrow();
    expect(() =>
      parseContract(
        SelectionResolvedEventSchema,
        { ...event, payload: { ...event.payload, extra: true } },
        "event",
      ),
    ).toThrow();
    expect(() =>
      parseContract(SelectionResolvedEventSchema, { ...event, version: 2 }, "event"),
    ).toThrow();
  });
});
