import { describe, expect, test } from "vitest";

import type { AgentActivity } from "@/types";

import {
  AGENT_ACTIVITY_VISIBILITY_MS,
  agentActivityVisualExpiry,
  agentActivitySummary,
  agentCellMarks,
  annotationStatusById,
  latestAgentActivityMessage,
  visibleAnnotations,
} from "@/lib/agent-activity";

const baseActor = {
  type: "agent" as const,
  label: "marimo-pair",
  runId: "run-1",
};

const baseProvenance = {
  origin: "agent" as const,
  source: "marimo-pair",
  protocol: "marimo-lens.agent-activity",
  version: 1,
};

describe("agent activity helpers", () => {
  test("keeps one region per cell with durable status and latest activity", () => {
    const activity: AgentActivity[] = [
      {
        id: "act-1",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:00Z",
        cellIds: ["cell-a"],
        status: "read",
      },
      {
        id: "act-2",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:01:00Z",
        cellIds: ["cell-a", "cell-b"],
        status: "edited",
        note: "Updated filter logic.",
      },
      {
        id: "act-3",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:02:00Z",
        cellIds: ["cell-a"],
        status: "ran",
        note: "Reran the edited cell.",
      },
    ];

    expect(agentCellMarks(activity)).toEqual([
      {
        id: "act-2",
        activityId: "act-3",
        cellId: "cell-a",
        kind: "edited",
        activityKind: "ran",
        active: false,
        note: "Updated filter logic.",
        activityNote: "Reran the edited cell.",
        createdAt: "2026-05-20T12:01:00Z",
        activityCreatedAt: "2026-05-20T12:02:00Z",
      },
      {
        id: "act-2",
        activityId: "act-2",
        cellId: "cell-b",
        kind: "edited",
        activityKind: "edited",
        active: false,
        note: "Updated filter logic.",
        activityNote: "Updated filter logic.",
        createdAt: "2026-05-20T12:01:00Z",
        activityCreatedAt: "2026-05-20T12:01:00Z",
      },
    ]);
  });

  test("only the latest claimed cell gets the live working sweep", () => {
    const activity: AgentActivity[] = [
      {
        id: "act-1",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:00Z",
        cellIds: ["cell-a"],
        status: "claimed",
      },
      {
        id: "act-2",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:01:00Z",
        cellIds: ["cell-b", "cell-c"],
        status: "claimed",
      },
    ];

    expect(agentCellMarks(activity).map((mark) => [mark.cellId, mark.active])).toEqual([
      ["cell-a", false],
      ["cell-b", true],
      ["cell-c", false],
    ]);

    expect(
      agentCellMarks([
        ...activity,
        {
          id: "act-3",
          kind: "cell-mark",
          actor: baseActor,
          provenance: baseProvenance,
          createdAt: "2026-05-20T12:02:00Z",
          cellIds: ["cell-b"],
          status: "ran",
        },
      ]).some((mark) => mark.active),
    ).toBe(false);
  });

  test("failed cell marks do not create persistent overlays", () => {
    const activity: AgentActivity[] = [
      {
        id: "act-1",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:00Z",
        cellIds: ["cell-a"],
        status: "edited",
      },
      {
        id: "act-2",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:01:00Z",
        cellIds: ["cell-a"],
        status: "failed",
      },
    ];

    expect(agentCellMarks(activity)).toEqual([]);
    expect(latestAgentActivityMessage(activity)).toMatchObject({
      title: "Needs a look",
      tone: "attention",
      cellId: "cell-a",
    });
  });

  test("agent overlays expire after the run finishes", () => {
    const activity: AgentActivity[] = [
      {
        id: "act-1",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:00Z",
        cellIds: ["cell-a"],
        status: "edited",
      },
      {
        id: "act-2",
        kind: "agent-finished",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:05Z",
        cellIds: ["cell-a"],
        annotationIds: [],
        status: "completed",
      },
    ];
    const expiry = Date.parse("2026-05-20T12:00:05Z") + AGENT_ACTIVITY_VISIBILITY_MS;

    expect(agentActivityVisualExpiry(activity)).toBe(expiry);
    expect(agentCellMarks(activity, { now: expiry - 1 })).toHaveLength(1);
    expect(agentCellMarks(activity, { now: expiry })).toEqual([]);
  });

  test("summarizes edited, run, and resolved receipts", () => {
    const activity: AgentActivity[] = [
      {
        id: "act-1",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:00Z",
        cellIds: ["cell-a", "cell-b"],
        status: "edited",
      },
      {
        id: "act-2",
        kind: "cell-mark",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:01:00Z",
        cellIds: ["cell-b", "cell-c"],
        status: "ran",
      },
      {
        id: "act-3",
        kind: "annotation-status",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:02:00Z",
        annotationIds: ["ml-1"],
        status: "addressed",
      },
    ];

    expect(agentActivitySummary(activity)?.text).toBe(
      "marimo-pair edited 2 cells, ran 2, resolved 1 annotation",
    );
  });

  test("tracks latest annotation status and hides addressed markers", () => {
    const activity: AgentActivity[] = [
      {
        id: "act-1",
        kind: "annotation-status",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:00:00Z",
        annotationIds: ["ml-1"],
        status: "in_progress",
      },
      {
        id: "act-2",
        kind: "annotation-status",
        actor: baseActor,
        provenance: baseProvenance,
        createdAt: "2026-05-20T12:01:00Z",
        annotationIds: ["ml-1"],
        status: "addressed",
        note: "Updated the chart.",
      },
    ];
    const statuses = annotationStatusById(activity);

    expect(statuses.get("ml-1")).toEqual({
      id: "act-2",
      status: "addressed",
      note: "Updated the chart.",
      createdAt: "2026-05-20T12:01:00Z",
    });
    expect(
      visibleAnnotations(
        [
          { id: "ml-1", label: "resolved" },
          { id: "ml-2", label: "open" },
        ],
        activity,
      ),
    ).toEqual([{ id: "ml-2", label: "open" }]);
  });
});
