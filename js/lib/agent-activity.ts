import type { AgentActivity, AgentCellMarkKind } from "@/types";

export const AGENT_ACTIVITY_VISIBILITY_MS = 10_000;

export type AgentCellMark = {
  id: string;
  activityId: string;
  cellId: string;
  kind: AgentCellMarkKind;
  activityKind: AgentCellMarkKind;
  active: boolean;
  note?: string;
  activityNote?: string;
  createdAt: string;
  activityCreatedAt: string;
};

export type AnnotationStatus = {
  id: string;
  status: "in_progress" | "addressed" | "blocked" | "needs_human";
  note?: string;
  createdAt: string;
};

export type AgentActivitySummary = {
  label: string;
  edited: number;
  ran: number;
  resolved: number;
  text: string;
};

export type AgentMessageTone = "neutral" | "working" | "success" | "attention";

export type AgentActivityMessage = {
  id: string;
  activityId: string;
  title: string;
  body: string;
  tone: AgentMessageTone;
  cellId?: string;
  createdAt: string;
};

export type AgentCellMarksOptions = {
  now?: number;
  finishedGraceMs?: number;
};

const CELL_MARK_KINDS = new Set<AgentCellMarkKind>([
  "read",
  "claimed",
  "edited",
  "ran",
  "failed",
  "needs-review",
]);

const DURABLE_MARK_PRIORITY = new Map<AgentCellMarkKind, number>([
  ["needs-review", 40],
  ["edited", 30],
  ["claimed", 20],
  ["read", 10],
]);

type AgentCellState = {
  durable?: AgentCellMark;
  latest?: AgentCellMark;
  hidden?: boolean;
};

export function agentCellMarks(
  activity: AgentActivity[],
  options: AgentCellMarksOptions = {},
): AgentCellMark[] {
  const now = options.now ?? Date.now();
  const finishedGraceMs = options.finishedGraceMs ?? AGENT_ACTIVITY_VISIBILITY_MS;
  if (agentActivityVisualsExpired(activity, now, finishedGraceMs)) return [];

  const activeFocus = latestClaimedFocus(activity);
  const states = new Map<string, AgentCellState>();
  for (const item of activity) {
    if (item.kind !== "cell-mark" || !isAgentCellMarkKind(item.status)) continue;
    for (const cellId of item.cellIds ?? []) {
      if (!cellId) continue;
      const next = {
        id: item.id,
        activityId: item.id,
        cellId,
        kind: item.status,
        activityKind: item.status,
        active: false,
        note: item.note,
        activityNote: item.note,
        createdAt: item.createdAt,
        activityCreatedAt: item.createdAt,
      };
      const state = states.get(cellId) ?? {};
      state.latest = next;
      if (item.status === "failed") {
        state.hidden = true;
        state.durable = undefined;
        states.set(cellId, state);
        continue;
      }
      state.hidden = false;
      if (item.status !== "ran" && shouldReplaceDurableMark(state.durable, next)) {
        state.durable = next;
      }
      states.set(cellId, state);
    }
  }
  return [...states.values()].flatMap((state) => {
    if (state.hidden) return [];
    const base = state.durable ?? state.latest;
    const latest = state.latest ?? base;
    if (!base || !latest) return [];
    return [
      {
        ...base,
        activityId: latest.id,
        activityKind: latest.kind,
        active: activeFocus?.activityId === latest.id && activeFocus.cellId === base.cellId,
        activityNote: latest.note,
        activityCreatedAt: latest.createdAt,
      },
    ];
  });
}

export function agentActivityVisualExpiry(
  activity: AgentActivity[],
  finishedGraceMs = AGENT_ACTIVITY_VISIBILITY_MS,
): number | null {
  const latest = latestVisualLifecycleActivity(activity);
  if (latest?.kind !== "agent-finished") return null;
  const createdAt = Date.parse(latest.createdAt);
  if (!Number.isFinite(createdAt)) return null;
  return createdAt + finishedGraceMs;
}

export function latestAgentActivityMessage(activity: AgentActivity[]): AgentActivityMessage | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const item = activity[index];
    if (!item) continue;
    const message = messageForActivity(item);
    if (message) return message;
  }
  return null;
}

export function agentActivitySummary(activity: AgentActivity[]): AgentActivitySummary | null {
  if (activity.length === 0) return null;
  const label = latestAgentLabel(activity) ?? "marimo-pair";
  const edited = uniqueCells(activity, "edited").size;
  const ran = uniqueCells(activity, "ran").size;
  const resolved = uniqueAddressedAnnotations(activity).size;
  return {
    label,
    edited,
    ran,
    resolved,
    text: `${label} edited ${edited} ${plural("cell", edited)}, ran ${ran}, resolved ${resolved} ${plural("annotation", resolved)}`,
  };
}

export function isAgentCellMarkKind(value: unknown): value is AgentCellMarkKind {
  return typeof value === "string" && CELL_MARK_KINDS.has(value as AgentCellMarkKind);
}

export function annotationStatusById(activity: AgentActivity[]): Map<string, AnnotationStatus> {
  const statuses = new Map<string, AnnotationStatus>();
  for (const item of activity) {
    if (item.kind !== "annotation-status" || !isAnnotationStatus(item.status)) continue;
    for (const annotationId of item.annotationIds ?? []) {
      if (!annotationId) continue;
      statuses.set(annotationId, {
        id: item.id,
        status: item.status,
        note: item.note,
        createdAt: item.createdAt,
      });
    }
  }
  return statuses;
}

export function annotationStatusLabel(status: AnnotationStatus["status"]): string {
  if (status === "in_progress") return "in progress";
  if (status === "needs_human") return "needs human";
  return status;
}

export function agentCellMarkLabel(mark: Pick<AgentCellMark, "kind" | "activityKind">): string {
  return agentCellMarkKindLabel(mark.activityKind);
}

export function agentCellActivityTitle(mark: Pick<AgentCellMark, "activityKind">): string {
  if (mark.activityKind === "read") return "Looking here";
  if (mark.activityKind === "claimed") return "Editing this cell";
  if (mark.activityKind === "edited") return "Changed this cell";
  if (mark.activityKind === "ran") return "Checking the result";
  return "Needs your review";
}

export function agentCellActivityMessage(
  mark: Pick<AgentCellMark, "activityKind" | "activityNote" | "note">,
): string {
  if (mark.activityNote) return mark.activityNote;
  if (mark.note) return mark.note;
  if (mark.activityKind === "read") return "marimo-pair is checking how this output is made.";
  if (mark.activityKind === "claimed") return "marimo-pair is focusing its next edit here.";
  if (mark.activityKind === "edited") return "marimo-pair changed this cell.";
  if (mark.activityKind === "ran")
    return "marimo-pair is running the notebook path that depends on it.";
  return "marimo-pair needs a human decision before continuing.";
}

export function visibleAnnotations<T extends { id: string }>(
  annotations: readonly T[],
  activity: AgentActivity[],
): T[] {
  const statuses = annotationStatusById(activity);
  return annotations.filter((annotation) => statuses.get(annotation.id)?.status !== "addressed");
}

function shouldReplaceDurableMark(
  previous: AgentCellMark | undefined,
  next: AgentCellMark,
): boolean {
  if (!previous) return true;
  const previousPriority = DURABLE_MARK_PRIORITY.get(previous.kind) ?? 0;
  const nextPriority = DURABLE_MARK_PRIORITY.get(next.kind) ?? 0;
  if (nextPriority > previousPriority) return true;
  if (nextPriority < previousPriority) return false;
  return next.createdAt >= previous.createdAt;
}

function agentActivityVisualsExpired(
  activity: AgentActivity[],
  now: number,
  finishedGraceMs: number,
): boolean {
  const expiry = agentActivityVisualExpiry(activity, finishedGraceMs);
  return expiry !== null && now >= expiry;
}

function latestVisualLifecycleActivity(activity: AgentActivity[]): AgentActivity | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const item = activity[index];
    if (!item) continue;
    if (
      item.kind === "agent-started" ||
      item.kind === "agent-finished" ||
      item.kind === "cell-mark"
    ) {
      return item;
    }
  }
  return null;
}

function latestClaimedFocus(
  activity: AgentActivity[],
): { activityId: string; cellId: string } | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const item = activity[index];
    if (!item) continue;
    if (item.kind === "agent-finished" || item.kind === "agent-started") return null;
    if (item.kind !== "cell-mark") continue;
    if (item.status !== "claimed") return null;
    const cellId = item.cellIds?.find((value) => Boolean(value));
    return cellId ? { activityId: item.id, cellId } : null;
  }
  return null;
}

function messageForActivity(item: AgentActivity): AgentActivityMessage | null {
  if (item.kind === "agent-started") {
    return {
      id: item.id,
      activityId: item.id,
      title: "Getting oriented",
      body: "marimo-pair is reading the notebook before changing anything.",
      tone: "working",
      createdAt: item.createdAt,
    };
  }

  if (item.kind === "agent-finished") {
    const status = item.status;
    return {
      id: item.id,
      activityId: item.id,
      title: status === "completed" ? "marimo-pair finished" : "Needs a look",
      body:
        status === "completed"
          ? "marimo-pair is done here. The notebook receipts will fade shortly."
          : "marimo-pair stopped before finishing and left the next step visible.",
      tone: status === "completed" ? "success" : "attention",
      cellId: item.cellIds?.[0],
      createdAt: item.createdAt,
    };
  }

  if (item.kind === "annotation-status") {
    const count = item.annotationIds?.length ?? 0;
    const label = count > 1 ? `${count} feedback notes` : "your feedback";
    if (item.status === "addressed") {
      return {
        id: item.id,
        activityId: item.id,
        title: "Feedback addressed",
        body: `marimo-pair marked ${label} as handled.`,
        tone: "success",
        createdAt: item.createdAt,
      };
    }
    if (item.status === "needs_human" || item.status === "blocked") {
      return {
        id: item.id,
        activityId: item.id,
        title: "Needs your review",
        body: "marimo-pair needs a human decision before it can continue.",
        tone: "attention",
        createdAt: item.createdAt,
      };
    }
    return {
      id: item.id,
      activityId: item.id,
      title: "Working on your feedback",
      body: `marimo-pair is addressing ${label}.`,
      tone: "working",
      createdAt: item.createdAt,
    };
  }

  if (item.kind !== "cell-mark" || !isAgentCellMarkKind(item.status)) return null;

  const cellId = item.cellIds?.find((value) => Boolean(value));
  if (item.status === "read") {
    return activityMessage(
      item,
      "Looking at this output",
      "marimo-pair is checking which cells shape this result.",
      "neutral",
      cellId,
    );
  }
  if (item.status === "claimed") {
    return activityMessage(
      item,
      "Editing here",
      "marimo-pair is focusing its next change on this cell.",
      "working",
      cellId,
    );
  }
  if (item.status === "edited") {
    return activityMessage(
      item,
      "Cell changed",
      "marimo-pair updated this part of the notebook.",
      "success",
      cellId,
    );
  }
  if (item.status === "ran") {
    return activityMessage(
      item,
      "Checking the result",
      "marimo-pair is running the notebook path that depends on this cell.",
      "working",
      cellId,
    );
  }
  if (item.status === "failed") {
    return activityMessage(
      item,
      "Needs a look",
      "marimo-pair hit a problem and left this as a message instead of a lasting overlay.",
      "attention",
      cellId,
    );
  }
  return activityMessage(
    item,
    "Needs your review",
    "marimo-pair needs a human decision before continuing.",
    "attention",
    cellId,
  );
}

function activityMessage(
  item: AgentActivity,
  title: string,
  body: string,
  tone: AgentMessageTone,
  cellId?: string,
): AgentActivityMessage {
  return {
    id: item.id,
    activityId: item.id,
    title,
    body,
    tone,
    cellId,
    createdAt: item.createdAt,
  };
}

function agentCellMarkKindLabel(kind: AgentCellMarkKind): string {
  if (kind === "read") return "looked here";
  if (kind === "claimed") return "working";
  if (kind === "edited") return "changed";
  if (kind === "ran") return "checked";
  if (kind === "failed") return "paused";
  return "needs review";
}

function isAnnotationStatus(value: unknown): value is AnnotationStatus["status"] {
  return (
    value === "in_progress" ||
    value === "addressed" ||
    value === "blocked" ||
    value === "needs_human"
  );
}

function uniqueCells(activity: AgentActivity[], kind: AgentCellMarkKind): Set<string> {
  const cells = new Set<string>();
  for (const item of activity) {
    if (item.kind !== "cell-mark" || item.status !== kind) continue;
    for (const cellId of item.cellIds ?? []) {
      if (cellId) cells.add(cellId);
    }
  }
  return cells;
}

function uniqueAddressedAnnotations(activity: AgentActivity[]): Set<string> {
  const annotations = new Set<string>();
  for (const item of activity) {
    if (item.kind !== "annotation-status" || item.status !== "addressed") continue;
    for (const annotationId of item.annotationIds ?? []) {
      if (annotationId) annotations.add(annotationId);
    }
  }
  return annotations;
}

function latestAgentLabel(activity: AgentActivity[]): string | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const label = activity[index]?.actor?.label;
    if (label) return label;
  }
  return null;
}

function plural(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}
