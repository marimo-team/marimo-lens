import type {
  AttentionEvent,
  SelectionResolvedEvent,
  TransportEnvelope,
} from "@marimo-lens/protocol";

import { parseAttentionEvent, parseSelectionResolvedEvent } from "@marimo-lens/protocol";

type SelectionResolvedListener = (event: SelectionResolvedEvent) => void;
type AttentionListener = (event: AttentionEvent) => void;

export class EventRouter {
  readonly #selectionResolvedListeners = new Set<SelectionResolvedListener>();
  readonly #attentionListeners = new Set<AttentionListener>();

  onSelectionResolved(listener: SelectionResolvedListener): () => void {
    this.#selectionResolvedListeners.add(listener);
    return () => this.#selectionResolvedListeners.delete(listener);
  }

  onAttention(listener: AttentionListener): () => void {
    this.#attentionListeners.add(listener);
    return () => this.#attentionListeners.delete(listener);
  }

  accept(message: TransportEnvelope, buffers: readonly DataView[] = []): boolean {
    if (message.protocol !== "marimo-lens.event") return false;
    if (
      message.type !== "selection.resolved" &&
      message.type !== "attention.activity.start" &&
      message.type !== "attention.activity.stop" &&
      message.type !== "attention.trail" &&
      message.type !== "attention.trail.stop" &&
      message.type !== "attention.reveal"
    ) {
      return false;
    }
    if (buffers.length !== 0) return true;
    if (message.type === "selection.resolved") {
      let event: SelectionResolvedEvent;
      try {
        event = parseSelectionResolvedEvent(message);
      } catch {
        return true;
      }
      dispatch(this.#selectionResolvedListeners, event);
      return true;
    }
    let event: AttentionEvent;
    try {
      event = parseAttentionEvent(message);
    } catch {
      return true;
    }
    dispatch(this.#attentionListeners, event);
    return true;
  }

  clear(): void {
    this.#selectionResolvedListeners.clear();
    this.#attentionListeners.clear();
  }
}

function dispatch<T>(listeners: ReadonlySet<(event: T) => void>, event: T): void {
  const failures: unknown[] = [];
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
