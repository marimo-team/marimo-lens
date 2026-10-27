import type {
  AttentionAddress,
  AttentionEvent,
  HistoryEntry,
  LensState,
  SelectionResolvedEvent,
  SelectionTarget,
  TrailStep,
} from "@marimo-lens/protocol";

import { MAX_RESOLVED_SELECTIONS } from "@marimo-lens/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { LensProtocolClient } from "@/anywidget/client";
import type { NotebookDomAdapter } from "@/notebook/notebook-dom";

import { targetBelongsToDocument } from "@/notebook/document-identity";
import {
  cellAddressTarget,
  type TargetAttentionPresentation,
  TargetAttentionController,
  type TargetLocator,
} from "@/transient/target-attention";
import { focusDock } from "@/ui/focus";

export function useTargetAttention(
  protocol: LensProtocolClient,
  dom: NotebookDomAdapter,
  state: LensState,
) {
  const [presentation, setPresentation] = useState<TargetAttentionPresentation | null>(null);
  const pending = useRef<PendingAttentionEvent[]>([]);
  const resolved = useRef<ResolvedSelections | null>(null);
  // The reveal waiting for its selection's resolved event, and when it began.
  const held = useRef<{ event: PendingAttentionEvent; since: number } | null>(null);
  const [attentionEventSequence, setAttentionEventSequence] = useState(0);
  const controller = useMemo(() => new TargetAttentionController(dom, setPresentation), [dom]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    pending.current = [];
    resolved.current = new ResolvedSelections();
    const releaseResolved = protocol.onSelectionResolved((event) => {
      resolvedIn(resolved).add(event);
      if (pending.current.length > 0) setAttentionEventSequence((current) => current + 1);
    });
    const releaseAttention = protocol.onAttention((event) => {
      if (event.type === "attention.trail.stop") {
        pending.current = pending.current.filter(
          (candidate) =>
            candidate.type !== "attention.reveal" || candidate.payload.id !== event.payload.trailId,
        );
        controller.endTrail(event.payload.trailId);
        return;
      }
      if (event.type === "attention.activity.stop") {
        pending.current = pending.current.filter(
          (candidate) =>
            candidate.type !== "attention.activity.start" ||
            candidate.payload.activityId !== event.payload.activityId,
        );
        controller.stopActivity(event.payload.activityId);
        setAttentionEventSequence((current) => current + 1);
        return;
      }
      pending.current.push(event);
      setAttentionEventSequence((current) => current + 1);
    });
    return () => {
      pending.current = [];
      releaseResolved();
      releaseAttention();
    };
  }, [controller, protocol]);
  useEffect(() => {
    const now = dom.window.Date.now();
    // Deleting or clearing selections also advances the revision by one and
    // sends no resolved event, so a reveal stops waiting for one after a
    // moment and plays against the state it has.
    let blockedIndex = -1;
    let awaiting: PendingAttentionEvent | null = null;
    for (const [index, event] of pending.current.entries()) {
      const blocked = blockedBy(event, state, resolvedIn(resolved));
      if (blocked === "resolution") {
        if (held.current?.event !== event) held.current = { event, since: now };
        if (now - held.current.since >= RESOLVED_EVENT_WAIT_MS) continue;
        awaiting = event;
      }
      if (blocked !== null) {
        blockedIndex = index;
        break;
      }
    }
    const ready = blockedIndex === -1 ? pending.current : pending.current.slice(0, blockedIndex);
    pending.current = pending.current.slice(ready.length);
    for (const event of ready) {
      const addresses =
        event.type === "attention.reveal"
          ? event.payload.steps.map((step) => step.address)
          : [event.payload.address];
      const locators = addresses.map((address) =>
        resolveTarget(
          address,
          event.type === "attention.reveal" ? resolvedIn(resolved) : null,
          state,
          dom,
        ),
      );
      if (!locators.every((locator): locator is TargetLocator => locator !== null)) continue;
      const targets = locators;
      const active = dom.activeElement;
      if (
        active instanceof dom.window.HTMLElement &&
        active.closest("[data-marimo-lens-resolution-receipt]")
      ) {
        focusDock(dom);
      }
      if (event.type === "attention.activity.start") {
        controller.startActivity(event.payload, targets[0]!);
      } else {
        controller.reveal(event.payload, targets);
      }
    }
    if (awaiting === null) return undefined;
    const timeout = dom.window.setTimeout(
      () => setAttentionEventSequence((current) => current + 1),
      RESOLVED_EVENT_WAIT_MS,
    );
    return () => dom.window.clearTimeout(timeout);
  }, [attentionEventSequence, controller, dom, state]);

  // History reveals a request's cells the way an agent's reveal() does, from
  // the browser alone.
  const revealCells = useCallback(
    (entry: HistoryEntry) => {
      const label = entry.label ?? "Chat request";
      const cells = new Map<string, string>();
      for (const cellId of entry.cellIds) cells.set(cellId, "The request pointed at this cell.");
      for (const { cellId, status } of entry.changes) {
        if (cellId) cells.set(cellId, CHANGE_MESSAGES[status]);
      }
      const visited = [...cells].slice(0, 16);
      if (visited.length === 0) return;
      const steps: TrailStep[] = visited.map(([cellId, message]) => ({
        address: { kind: "cell", cellId },
        label,
        message,
      }));
      controller.reveal(
        { id: `${HISTORY_TRAIL}${entry.id}:${entry.resolvedAt}`, steps },
        visited.map(([cellId]) => ({
          kind: "cell",
          label: cellId,
          resolve: () => cellAddressTarget(dom, cellId),
        })),
      );
    },
    [controller, dom],
  );
  // A receipt waits for the agent's attention so the person sees the result
  // first. The person's own History trail is not the agent's.
  const agentAttention = presentation?.trail?.id.startsWith(HISTORY_TRAIL) ? null : presentation;
  return { presentation, agentAttentionKind: agentAttention?.kind ?? null, revealCells };
}

const HISTORY_TRAIL = "history:";

const CHANGE_MESSAGES: Record<HistoryEntry["changes"][number]["status"], string> = {
  in_force: "The request changed this cell, and the change holds.",
  undone: "The request changed this cell, and the change was undone.",
  unknown: "The request changed this cell. The record did not keep the code.",
};

type PendingAttentionEvent = Exclude<
  AttentionEvent,
  { type: "attention.activity.stop" | "attention.trail.stop" }
>;

function resolveTarget(
  address: AttentionAddress,
  resolved: ResolvedSelections | null,
  state: LensState,
  dom: NotebookDomAdapter,
): TargetLocator | null {
  if (address.kind === "cell") {
    return {
      kind: "cell",
      label: address.cellId,
      resolve: () => cellAddressTarget(dom, address.cellId),
    };
  }
  // Open selection identity and target are immutable, so a later canonical
  // revision can safely resolve an event whose model update was coalesced.
  if (state.revision < address.revision) return null;
  const selection =
    state.selections.find((candidate) => candidate.id === address.selectionId) ??
    resolved?.resolvedAfter(address);
  if (!selection || !targetBelongsToDocument(selection.target, dom.document)) return null;
  const { target } = selection;
  return {
    kind: "selection",
    label: selection.label,
    resolve: () => dom.getTarget(target)?.element ?? null,
  };
}

// A reveal sent just before resolve() can arrive after its selection left the
// state and before the resolved event that locates it. resolve() advances the
// revision by one, so any later change ends the wait.
const RESOLVED_EVENT_WAIT_MS = 1_000;

/** Say what an attention event waits for before it can play, if anything. */
function blockedBy(
  event: PendingAttentionEvent,
  state: LensState,
  resolved: ResolvedSelections,
): "revision" | "resolution" | null {
  const addresses =
    event.type === "attention.reveal"
      ? event.payload.steps.map((step) => step.address)
      : [event.payload.address];
  let blocked: "revision" | "resolution" | null = null;
  for (const address of addresses) {
    if (address.kind !== "selection") continue;
    if (state.revision < address.revision) return "revision";
    if (event.type === "attention.reveal" && awaitsResolvedEvent(address, state, resolved)) {
      blocked = "resolution";
    }
  }
  return blocked;
}

function awaitsResolvedEvent(
  address: Extract<AttentionAddress, { kind: "selection" }>,
  state: LensState,
  resolved: ResolvedSelections,
): boolean {
  return (
    state.revision === address.revision + 1 &&
    resolved.revision < state.revision &&
    !state.selections.some(({ id }) => id === address.selectionId) &&
    !resolved.resolvedAfter(address)
  );
}

type ResolvedSelection = { label: string; target: SelectionTarget; revision: number };

const REMEMBERED_RESOLUTIONS = 4;
const RESOLVED_SELECTION_LIMIT = REMEMBERED_RESOLUTIONS * MAX_RESOLVED_SELECTIONS;

/** The selections resolved while this view listened, created on first use. */
function resolvedIn(ref: RefObject<ResolvedSelections | null>): ResolvedSelections {
  return (ref.current ??= new ResolvedSelections());
}

class ResolvedSelections {
  readonly #selections = new Map<string, ResolvedSelection>();
  revision = -1;

  add(event: SelectionResolvedEvent): void {
    this.revision = Math.max(this.revision, event.revision);
    for (const { selectionId, label, target } of event.payload.selections) {
      const known = this.#selections.get(selectionId);
      if (known && known.revision >= event.revision) continue;
      this.#selections.delete(selectionId);
      this.#selections.set(selectionId, { label, target, revision: event.revision });
    }
    for (const selectionId of this.#selections.keys()) {
      if (this.#selections.size <= RESOLVED_SELECTION_LIMIT) break;
      this.#selections.delete(selectionId);
    }
  }

  resolvedAfter(
    address: Extract<AttentionAddress, { kind: "selection" }>,
  ): ResolvedSelection | undefined {
    const selection = this.#selections.get(address.selectionId);
    return selection && selection.revision > address.revision ? selection : undefined;
  }
}
