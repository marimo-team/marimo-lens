import { describe, expect, test } from "vite-plus/test";

import {
  ActivateSelectionCommandSchema,
  AttentionActivityStartEventSchema,
  AttentionActivityStopEventSchema,
  AttentionRevealEventSchema,
  TrailSchema,
  ClearHistoryCommandSchema,
  GetSnapshotCommandSchema,
  DeleteSelectionCommandSchema,
  LensStateSchema,
  OutputCaptureCommandSchema,
  OutputCaptureFailurePayloadSchema,
  OutputCaptureResponsePayloadSchema,
  PutSelectionCommandSchema,
  ReopenSelectionCommandSchema,
  SelectionResolvedEventSchema,
  SelectionSchema,
  parseContract,
  parseLensResponse,
  parseTransportEnvelope,
} from "../src/index";
import { selectionFixture } from "./fixtures";

describe("transport envelope", () => {
  test("carries a bounded transient Trail in its start event", () => {
    const trail = {
      id: "trail-1",
      steps: [{ address: { kind: "cell" as const, cellId: "cell-1" }, label: "Question" }],
    };
    expect(
      parseContract(
        AttentionRevealEventSchema,
        {
          protocol: "marimo-lens.event",
          version: 6,
          type: "attention.reveal",
          payload: trail,
        },
        "event",
      ).payload,
    ).toEqual(trail);
    expect(() => parseContract(TrailSchema, { ...trail, steps: [] }, "trail")).toThrow();
    expect(() =>
      parseContract(
        TrailSchema,
        { ...trail, steps: Array.from({ length: 17 }, () => trail.steps[0]) },
        "trail",
      ),
    ).toThrow();
  });

  test("decodes object discriminators and preserves the message body", () => {
    const message = {
      protocol: "marimo-lens.response",
      requestId: "request-1",
      type: "selection.put",
      payload: { selectionId: "selection-1" },
    };

    expect(parseTransportEnvelope(message)).toEqual(message);
  });

  test("rejects primitive transport values", () => {
    expect(parseTransportEnvelope(null)).toBeNull();
    expect(parseTransportEnvelope(undefined)).toBeNull();
    expect(parseTransportEnvelope("kernel.status")).toBeNull();
  });

  test("rejects a non-string request identifier", () => {
    expect(
      parseTransportEnvelope({
        protocol: "marimo-lens.response",
        requestId: 7,
      }),
    ).toBeNull();
  });
});

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
          history: [],
        },
        "state",
      ),
    ).toMatchObject({
      revision: 3,
      nextLabel: "S2",
      currentSelectionId: "selection-1",
      history: [],
    });
  });

  test("projects supported fields from additive selection state", () => {
    const canonical = selectionFixture();
    const projected = parseContract(
      LensStateSchema,
      {
        revision: 3,
        nextLabel: "S2",
        currentSelectionId: "selection-1",
        selections: [
          {
            ...canonical,
            sourceRevision: 7,
            anchor: { ...canonical.anchor, pixelRatio: 2 },
            snapshot: { ...canonical.snapshot, colorSpace: "srgb" },
          },
        ],
        history: [],
        runtimeRevision: 11,
      },
      "state",
    );

    expect(projected).toEqual({
      revision: 3,
      nextLabel: "S2",
      currentSelectionId: "selection-1",
      selections: [canonical],
      history: [],
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
          history: [],
        },
        "state",
      ),
    ).toThrow();
  });

  test("accepts addressed history and one previous resolution on an open selection", () => {
    const addressed = {
      selectionId: "selection-1",
      label: "S1",
      note: "Align this label",
      description: { label: "Cell cell-1" },
      target: {
        kind: "notebook" as const,
        cellIds: ["cell-1"],
        documentId: "document-1",
        documentPath: "/",
      },
      createdAt: "2026-07-14T10:00:00Z",
      addressedAt: "2026-07-14T10:05:00Z",
      anchor: { kind: "point" as const, x: 0.25, y: 0.5 },
      summary: "Updated the label and verified the chart.",
      resolutionRevision: 4,
    };
    const state = parseContract(
      LensStateSchema,
      {
        revision: 5,
        nextLabel: "S2",
        currentSelectionId: "selection-1",
        selections: [
          selectionFixture({
            snapshot: { status: "pending" },
            previousResolution: {
              addressedAt: addressed.addressedAt,
              summary: addressed.summary,
            },
          }),
        ],
        history: [addressed],
      },
      "state",
    );

    expect(state.history).toEqual([addressed]);
    expect(state.selections[0]?.previousResolution).toEqual({
      addressedAt: addressed.addressedAt,
      summary: addressed.summary,
    });

    const sharedRevision = [
      { ...addressed, resolutionRevision: 5 },
      { ...addressed, selectionId: "selection-2", label: "S2", resolutionRevision: 5 },
    ];
    expect(
      parseContract(LensStateSchema, { ...state, history: sharedRevision }, "state").history,
    ).toEqual(sharedRevision);
    expect(() =>
      parseContract(
        LensStateSchema,
        {
          ...state,
          history: [addressed, addressed],
        },
        "state",
      ),
    ).toThrow("History selection revisions must be unique and ordered");
  });

  test("requires an exact addressed receipt for reopen commands", () => {
    const reopen = {
      protocol: "marimo-lens.command",
      version: 6,
      requestId: "request-1",
      type: "selection.reopen",
      payload: {
        selectionId: "selection-1",
        resolutionRevision: 4,
        expectedRevision: 4,
      },
    };
    expect(parseContract(ReopenSelectionCommandSchema, reopen, "command")).toEqual(reopen);
    expect(() =>
      parseContract(
        ReopenSelectionCommandSchema,
        {
          ...reopen,
          payload: { ...reopen.payload, resolutionRevision: -1 },
        },
        "command",
      ),
    ).toThrow();

    const clearHistory = {
      protocol: "marimo-lens.command",
      version: 6,
      requestId: "request-2",
      type: "history.clear",
      payload: { expectedRevision: 4 },
    };
    expect(parseContract(ClearHistoryCommandSchema, clearHistory, "command")).toEqual(clearHistory);
  });

  test("requires positive rectangles contained by the target", () => {
    expect(() =>
      parseContract(
        SelectionSchema,
        selectionFixture({
          anchor: { kind: "rect", x: 0.8, y: 0.2, width: 0.3, height: 0.2 },
        }),
        "selection",
      ),
    ).toThrow("Selection rectangle extends beyond its target");
  });

  test("accepts notebook and DOM target contracts", () => {
    const targets = [
      {
        kind: "notebook" as const,
        cellIds: ["cell-1"],
        documentId: "document-1",
        documentPath: "/",
      },
      {
        kind: "dom" as const,
        sources: [],
        cellIds: [],
        documentId: "document-1",
        documentPath: "/dashboard/",
        domSelector: "#forecast-summary",
      },
    ];

    for (const target of targets) {
      expect(
        parseContract(SelectionSchema, selectionFixture({ target }), "selection").target,
      ).toEqual(target);
    }

    const unordered = selectionFixture({
      target: {
        kind: "dom",
        sources: [
          { cellId: "cell-a", selector: null },
          { cellId: "cell-b", selector: "summary.total" },
        ],
        cellIds: ["cell-b", "cell-a"],
        documentId: "document-1",
        documentPath: "/dashboard/",
        domSelector: "#forecast-summary",
      },
    });
    expect(parseContract(SelectionSchema, unordered, "selection").target.cellIds).toEqual([
      "cell-a",
      "cell-b",
    ]);
    expect(() =>
      parseContract(
        SelectionSchema,
        {
          ...unordered,
          target: {
            ...unordered.target,
            sources: [{ cellId: "another-cell", selector: "summary.total" }],
          },
        },
        "selection",
      ),
    ).toThrow("Notebook sources must belong to the target cells");
  });

  test("matches Python text, timestamp, and safe-integer bounds", () => {
    const pending = selectionFixture({ snapshot: { status: "pending" } });
    for (const selection of [
      { ...pending, id: "x".repeat(129) },
      { ...pending, note: "bad\ud800text" },
      { ...pending, note: "bad text\ud800" },
      { ...pending, createdAt: "2026-02-30T10:01:00Z" },
      { ...pending, createdAt: "2026-07-20T10:01:00" },
      { ...pending, createdAt: "2026-07-20T10:01:00+00:60" },
      { ...pending, createdAt: "2026-07-20T10:01:00+24:00" },
    ]) {
      expect(() => parseContract(SelectionSchema, selection, "selection")).toThrow();
    }

    for (const blank of ["\u0085", "\ufeff", "\u001c"]) {
      expect(() =>
        parseContract(
          ActivateSelectionCommandSchema,
          {
            protocol: "marimo-lens.command",
            version: 6,
            requestId: "request-1",
            type: "selection.activate",
            payload: { selectionId: blank, expectedRevision: 0 },
          },
          "command",
        ),
      ).toThrow();
    }

    expect(
      parseContract(
        SelectionSchema,
        selectionFixture({
          anchor: { kind: "rect", x: 0, y: 0, width: 1e-20, height: 1e-20 },
        }),
        "selection",
      ),
    ).toMatchObject({ anchor: { width: 1e-20, height: 1e-20 } });

    const failed = {
      protocol: "marimo-lens.response",
      version: 6,
      requestId: "request-1",
      ok: false,
      revision: 1,
      payload: {},
      error: { code: "x".repeat(129), message: "x" },
    };
    expect(() => parseLensResponse(failed)).toThrow();
    expect(() =>
      parseLensResponse({ ...failed, error: { code: "capture_failed", message: "x".repeat(501) } }),
    ).toThrow();
  });

  test("requires expected revisions on every mutation", () => {
    expect(() =>
      parseContract(
        PutSelectionCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 6,
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
          version: 6,
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
          version: 6,
          requestId: "request-1",
          type: "selection.delete",
          payload: { selectionId: "selection-1" },
        },
        "command",
      ),
    ).toThrow();
  });

  test("keeps snapshot reads revision free", () => {
    expect(
      parseContract(
        GetSnapshotCommandSchema,
        {
          protocol: "marimo-lens.command",
          version: 6,
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
      version: 6,
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

  test("validates bounded selection resolution events", () => {
    const event = {
      protocol: "marimo-lens.event",
      version: 6,
      type: "selection.resolved",
      revision: 4,
      payload: {
        selections: [
          {
            selectionId: "selection-1",
            label: "S1",
            resolutionRevision: 4,
          },
        ],
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
        { ...event, payload: { ...event.payload, summary: "   " } },
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
    expect(
      parseContract(
        SelectionResolvedEventSchema,
        { ...event, payload: { ...event.payload, displayHint: "compact" } },
        "event",
      ),
    ).toEqual(event);
    for (const version of [5, 7]) {
      expect(() =>
        parseContract(SelectionResolvedEventSchema, { ...event, version }, "event"),
      ).toThrow();
    }
    expect(() =>
      parseContract(
        SelectionResolvedEventSchema,
        {
          ...event,
          payload: {
            selections: [...event.payload.selections, ...event.payload.selections],
          },
        },
        "event",
      ),
    ).toThrow();
  });

  test("accepts bounded reveal steps and an optional whole-reveal duration", () => {
    const step = {
      address: { kind: "cell", cellId: "BYtC" },
      label: "Updated chart",
      message: "Updated the aggregation.",
    };
    const reveal = {
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.reveal",
      payload: { id: "reveal-1", steps: [step], durationMs: 8_000 },
    };
    expect(parseContract(AttentionRevealEventSchema, reveal, "event")).toEqual(reveal);
    const held = { ...reveal, payload: { id: "held", steps: [step] } };
    expect(parseContract(AttentionRevealEventSchema, held, "event")).toEqual(held);
    for (const invalidStep of [
      { ...step, address: { kind: "cell", cellId: "x".repeat(129) } },
      { ...step, message: "   " },
      { ...step, message: "x".repeat(1_001) },
      { ...step, label: "x".repeat(41) },
    ]) {
      expect(() =>
        parseContract(
          AttentionRevealEventSchema,
          {
            ...reveal,
            payload: { ...reveal.payload, steps: [invalidStep] },
          },
          "event",
        ),
      ).toThrow();
    }
    for (const durationMs of [0, 300_001, 1.5]) {
      expect(() =>
        parseContract(
          AttentionRevealEventSchema,
          {
            ...reveal,
            payload: { ...reveal.payload, durationMs },
          },
          "event",
        ),
      ).toThrow();
    }
    expect(
      parseContract(
        AttentionRevealEventSchema,
        {
          ...reveal,
          payload: {
            ...reveal.payload,
            steps: [{ ...step, message: "x".repeat(1_000) }],
            durationMs: 300_000,
            displayHint: "compact",
          },
        },
        "event",
      ).payload,
    ).toEqual({
      id: "reveal-1",
      steps: [{ ...step, message: "x".repeat(1_000) }],
      durationMs: 300_000,
    });
  });

  test("accepts bounded target activity start events", () => {
    const activity = {
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.activity.start",
      payload: {
        activityId: "activity-1",
        address: { kind: "selection" as const, selectionId: "selection-1", revision: 4 },
        durationMs: 8_000,
        label: "On it",
        message: "Updating the aggregation.",
      },
    };
    expect(parseContract(AttentionActivityStartEventSchema, activity, "event")).toEqual(activity);
    const persistent = {
      ...activity,
      payload: { activityId: "activity-1", address: activity.payload.address },
    };
    expect(parseContract(AttentionActivityStartEventSchema, persistent, "event")).toEqual(
      persistent,
    );
    expect(
      parseContract(
        AttentionActivityStartEventSchema,
        { ...activity, payload: { ...activity.payload, displayHint: "compact" } },
        "event",
      ),
    ).toEqual(activity);
    expect(() =>
      parseContract(
        AttentionActivityStartEventSchema,
        { ...activity, payload: { ...activity.payload, message: "   " } },
        "event",
      ),
    ).toThrow();
    expect(() =>
      parseContract(
        AttentionActivityStartEventSchema,
        { ...activity, payload: { ...activity.payload, label: "x".repeat(41) } },
        "event",
      ),
    ).toThrow();
    for (const durationMs of [0, 300_001, 1.5]) {
      expect(() =>
        parseContract(
          AttentionActivityStartEventSchema,
          { ...activity, payload: { ...activity.payload, durationMs } },
          "event",
        ),
      ).toThrow();
    }
    for (const address of [
      { kind: "selection", selectionId: "selection-1" },
      { kind: "selection", selectionId: "selection-1", revision: -1 },
      { kind: "cell", cellId: "" },
      { kind: "selector", selector: "#projection" },
    ]) {
      expect(() =>
        parseContract(
          AttentionActivityStartEventSchema,
          { ...activity, payload: { ...activity.payload, address } },
          "event",
        ),
      ).toThrow();
    }
  });

  test("accepts an owner-specific activity stop event", () => {
    const stop = {
      protocol: "marimo-lens.event",
      version: 6,
      type: "attention.activity.stop",
      payload: { activityId: "activity-1" },
    };
    expect(parseContract(AttentionActivityStopEventSchema, stop, "event")).toEqual(stop);
    expect(() =>
      parseContract(
        AttentionActivityStopEventSchema,
        { ...stop, payload: { activityId: "" } },
        "event",
      ),
    ).toThrow();
  });

  test("correlates output capture messages by request and exact cell", () => {
    const command = {
      protocol: "marimo-lens.command",
      version: 6,
      requestId: "capture-1",
      type: "output.capture",
      payload: {
        outputCellId: "cell-view",
      },
    };
    const image = {
      status: "available" as const,
      id: "image:capture-1",
      mediaType: "image/png" as const,
      width: 640,
      height: 480,
      sha256: "a".repeat(64),
      capturedAt: "2026-07-19T10:00:00Z",
    };

    expect(parseContract(OutputCaptureCommandSchema, command, "command")).toEqual(command);
    expect(
      parseContract(
        OutputCaptureResponsePayloadSchema,
        { outputCellId: "cell-view", image },
        "payload",
      ),
    ).toEqual({ outputCellId: "cell-view", image });
    expect(
      parseContract(OutputCaptureFailurePayloadSchema, { outputCellId: "cell-view" }, "payload"),
    ).toEqual({ outputCellId: "cell-view" });
    expect(
      parseContract(
        OutputCaptureCommandSchema,
        { ...command, payload: { ...command.payload, trace: "browser" } },
        "command",
      ),
    ).toEqual(command);
    expect(
      parseContract(
        OutputCaptureResponsePayloadSchema,
        { outputCellId: "cell-view", image, trace: "browser" },
        "payload",
      ),
    ).toEqual({ outputCellId: "cell-view", image });
    expect(
      parseContract(
        OutputCaptureFailurePayloadSchema,
        { outputCellId: "cell-view", trace: "browser" },
        "payload",
      ),
    ).toEqual({ outputCellId: "cell-view" });
  });
});
