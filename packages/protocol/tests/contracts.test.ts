import { describe, expect, test } from "vite-plus/test";

import {
  ActivateSelectionCommandSchema,
  AttentionActivityStartEventSchema,
  AttentionActivityStopEventSchema,
  AttentionRevealEventSchema,
  ClientCommandSchema,
  DeleteSelectionCommandSchema,
  GetSnapshotCommandSchema,
  LensStateSchema,
  PutSelectionCommandSchema,
  SelectionResolvedEventSchema,
  SelectionSchema,
  OutputCaptureResponsePayloadSchema,
  WIDGET_TRANSPORT_VERSION,
  parseContract,
  parseLensResponse,
  parseTargetMedia,
  parseTransportEnvelope,
} from "../src/index";
import { selectionFixture } from "./fixtures";

describe("transport envelope", () => {
  test("decodes object discriminators and preserves the message body", () => {
    const message = {
      protocol: "marimo-lens.response",
      requestId: "request-1",
      type: "selection.put",
      payload: { selectionId: "selection-1" },
    };

    expect(parseTransportEnvelope(message)).toEqual(message);
  });

  test.each([null, undefined, "kernel.status", { protocol: "marimo-lens.response", requestId: 7 }])(
    "rejects %o",
    (value) => {
      expect(parseTransportEnvelope(value)).toBeNull();
    },
  );
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

  test("projects supported fields from additive selection state", () => {
    const canonical = selectionFixture({
      previousResolution: {
        addressedAt: "2026-07-14T10:05:00Z",
        summary: "Updated the label and verified the chart.",
      },
    });
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

  test("rejects state that repeats a selection", () => {
    expect(() =>
      parseContract(
        LensStateSchema,
        {
          revision: 3,
          nextLabel: "S2",
          currentSelectionId: "selection-1",
          selections: [selectionFixture(), selectionFixture()],
          history: [],
        },
        "state",
      ),
    ).toThrow("Selection ids and labels must be unique");
  });

  test("rejects a current selection that the state does not hold", () => {
    expect(() =>
      parseContract(
        LensStateSchema,
        {
          revision: 3,
          nextLabel: "S2",
          currentSelectionId: "missing",
          selections: [selectionFixture()],
          history: [],
        },
        "state",
      ),
    ).toThrow();
  });
  test("rejects a selection label outside the S1, S2, … sequence", () => {
    expect(() =>
      parseContract(
        SelectionSchema,
        { ...selectionFixture(), label: "selection-one" },
        "selection",
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
      version: WIDGET_TRANSPORT_VERSION,
      requestId: "request-1",
      type: "selection.reopen",
      payload: {
        selectionId: "selection-1",
        resolutionRevision: 4,
        expectedRevision: 4,
      },
    };
    expect(parseContract(ClientCommandSchema, reopen, "command")).toEqual(reopen);
    expect(() =>
      parseContract(
        ClientCommandSchema,
        {
          ...reopen,
          payload: { ...reopen.payload, resolutionRevision: -1 },
        },
        "command",
      ),
    ).toThrow();

    const clearHistory = {
      protocol: "marimo-lens.command",
      version: WIDGET_TRANSPORT_VERSION,
      requestId: "request-2",
      type: "history.clear",
      payload: { expectedRevision: 4 },
    };
    expect(parseContract(ClientCommandSchema, clearHistory, "command")).toEqual(clearHistory);
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

  test("matches Python text, timestamp, geometry, and error bounds", () => {
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
            version: WIDGET_TRANSPORT_VERSION,
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
      version: WIDGET_TRANSPORT_VERSION,
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

  test.each([
    {
      schema: PutSelectionCommandSchema,
      type: "selection.put",
      payload: { selection: selectionFixture(), imageAction: "replace" },
      accepted: false,
    },
    {
      schema: ActivateSelectionCommandSchema,
      type: "selection.activate",
      payload: { selectionId: "selection-1" },
      accepted: false,
    },
    {
      schema: DeleteSelectionCommandSchema,
      type: "selection.delete",
      payload: { selectionId: "selection-1" },
      accepted: false,
    },
    {
      schema: GetSnapshotCommandSchema,
      type: "snapshot.get",
      payload: { selectionId: "selection-1" },
      accepted: true,
    },
  ])(
    "$type without an expected revision is accepted: $accepted",
    ({ schema, type, payload, accepted }) => {
      const command = {
        protocol: "marimo-lens.command",
        version: WIDGET_TRANSPORT_VERSION,
        requestId: "request-1",
        type,
        payload,
      };
      const parse = () => parseContract(schema, command, "command");
      if (accepted) expect(parse()).toMatchObject({ payload });
      else expect(parse).toThrow();
    },
  );

  test.each([
    { status: "available", imageAction: "clear", accepted: false },
    { status: "pending", imageAction: "replace", accepted: false },
    { status: "pending", imageAction: "clear", accepted: true },
    { status: "available", imageAction: "replace", accepted: true },
  ] as const)(
    "a $status snapshot with imageAction $imageAction is accepted: $accepted",
    ({ status, imageAction, accepted }) => {
      const selection =
        status === "pending" ? selectionFixture({ snapshot: { status } }) : selectionFixture();
      const command = {
        protocol: "marimo-lens.command",
        version: WIDGET_TRANSPORT_VERSION,
        requestId: "request-1",
        type: "selection.put",
        payload: { selection, imageAction, expectedRevision: 0 },
      };
      const parse = () => parseContract(PutSelectionCommandSchema, command, "command");
      if (accepted) expect(parse()).toMatchObject({ payload: { imageAction } });
      else expect(parse).toThrow("Snapshot status does not match imageAction");
    },
  );

  describe("selection resolution events", () => {
    const event = {
      protocol: "marimo-lens.event",
      version: WIDGET_TRANSPORT_VERSION,
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

    const [resolved] = event.payload.selections;
    const { resolutionRevision: _, ...withoutRevision } = resolved!;

    test("reads a resolution event", () => {
      expect(parseContract(SelectionResolvedEventSchema, event, "event")).toEqual(event);
    });

    test.each([
      {
        name: "a repeated selection",
        value: {
          ...event,
          payload: {
            ...event.payload,
            selections: [...event.payload.selections, ...event.payload.selections],
          },
        },
      },
      {
        // 121 emoji are 242 UTF-16 code units, past the summary bound Python counts the same way.
        name: "a summary past its UTF-16 bound",
        value: { ...event, payload: { ...event.payload, summary: "😀".repeat(121) } },
      },
      {
        name: "another protocol version",
        value: { ...event, version: WIDGET_TRANSPORT_VERSION + 1 },
      },
      {
        name: "a label outside the S1, S2, … sequence",
        value: {
          ...event,
          payload: { ...event.payload, selections: [{ ...resolved, label: "S0" }] },
        },
      },
      {
        name: "a selection without its resolution revision",
        value: { ...event, payload: { ...event.payload, selections: [withoutRevision] } },
      },
    ])("rejects $name", ({ value }) => {
      expect(() => parseContract(SelectionResolvedEventSchema, value, "event")).toThrow();
    });
  });

  describe("attention events", () => {
    const step = {
      address: { kind: "cell", cellId: "BYtC" },
      label: "Updated chart",
      message: "Updated the aggregation.",
    };
    const reveal = {
      protocol: "marimo-lens.event",
      version: WIDGET_TRANSPORT_VERSION,
      type: "attention.reveal",
      payload: { id: "reveal-1", steps: [step], durationMs: 8_000 },
    };
    const activity = {
      protocol: "marimo-lens.event",
      version: WIDGET_TRANSPORT_VERSION,
      type: "attention.activity.start",
      payload: {
        activityId: "activity-1",
        address: { kind: "selection", selectionId: "selection-1", revision: 4 },
        durationMs: 8_000,
        label: "On it",
        message: "Updating the aggregation.",
      },
    };

    test.each([
      { name: "a timed reveal", schema: AttentionRevealEventSchema, value: reveal },
      {
        name: "a held reveal",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, payload: { id: "held", steps: [step] } },
      },
      { name: "a timed activity", schema: AttentionActivityStartEventSchema, value: activity },
      {
        name: "a persistent activity",
        schema: AttentionActivityStartEventSchema,
        value: {
          ...activity,
          payload: { activityId: "activity-1", address: activity.payload.address },
        },
      },
      {
        name: "an activity stop",
        schema: AttentionActivityStopEventSchema,
        value: {
          protocol: "marimo-lens.event",
          version: WIDGET_TRANSPORT_VERSION,
          type: "attention.activity.stop",
          payload: { activityId: "activity-1" },
        },
      },
      {
        name: "a reveal with fields this version does not know",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, trace: "python", payload: { ...reveal.payload, trace: "python" } },
        expected: reveal,
      },
    ])("reads $name", ({ schema, value, expected }) => {
      expect(parseContract(schema, value, "event")).toEqual(expected ?? value);
    });

    test.each([
      {
        name: "a reveal without steps",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, payload: { ...reveal.payload, steps: [] } },
      },
      {
        name: "a zero duration",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, payload: { ...reveal.payload, durationMs: 0 } },
      },
      {
        name: "a fractional duration",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, payload: { ...reveal.payload, durationMs: 1.5 } },
      },
      {
        name: "a duration past five minutes",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, payload: { ...reveal.payload, durationMs: 300_001 } },
      },
      {
        name: "a reveal past 16 steps",
        schema: AttentionRevealEventSchema,
        value: { ...reveal, payload: { ...reveal.payload, steps: Array(17).fill(step) } },
      },
      {
        name: "a label past 40 units",
        schema: AttentionActivityStartEventSchema,
        value: { ...activity, payload: { ...activity.payload, label: "x".repeat(41) } },
      },
      {
        name: "a selector address",
        schema: AttentionActivityStartEventSchema,
        value: {
          ...activity,
          payload: { ...activity.payload, address: { kind: "selector", selector: "#projection" } },
        },
      },
      {
        name: "a selection address without its revision",
        schema: AttentionActivityStartEventSchema,
        value: {
          ...activity,
          payload: {
            ...activity.payload,
            address: { kind: "selection", selectionId: "selection-1" },
          },
        },
      },
    ])("rejects $name", ({ schema, value }) => {
      expect(() => parseContract(schema, value, "event")).toThrow();
    });
  });
});

test("target media names a page or a time span that ends after it starts", () => {
  expect(parseTargetMedia({ path: "report.pdf", page: 2 })).toEqual({
    path: "report.pdf",
    page: 2,
  });
  expect(parseTargetMedia({ path: "animation.mp4", start: 3.2 })).toEqual({
    path: "animation.mp4",
    start: 3.2,
  });
  expect(() => parseTargetMedia({ path: "animation.mp4", start: 4, end: 4 })).toThrow(
    "Media end must come after its start",
  );
  expect(() => parseTargetMedia({ path: "report.pdf", sheet: 1 })).toThrow();
});

test("an output capture response tolerates fields this version does not know", () => {
  const image = {
    status: "available",
    id: "image:capture-1",
    mediaType: "image/png",
    width: 640,
    height: 480,
    sha256: "a".repeat(64),
    capturedAt: "2026-07-19T10:00:00Z",
  };

  expect(
    parseContract(
      OutputCaptureResponsePayloadSchema,
      { outputCellId: "cell-view", image, trace: "browser" },
      "payload",
    ),
  ).toEqual({ outputCellId: "cell-view", image });
});
