import type { CellAttentionEvent, SelectionResolvedEvent } from "@marimo-lens/protocol";

import {
  parseCellActivityEvent,
  parseCellRevealEvent,
  parseSelectionResolvedEvent,
} from "@marimo-lens/protocol";

const EVENT_PROTOCOL = "marimo-lens.event";

type SelectionResolvedListener = (event: SelectionResolvedEvent) => void;
type CellAttentionListener = (event: CellAttentionEvent) => void;

export class EventRouter {
  readonly #selectionResolvedListeners = new Set<SelectionResolvedListener>();
  readonly #cellAttentionListeners = new Set<CellAttentionListener>();

  onSelectionResolved(listener: SelectionResolvedListener): () => void {
    this.#selectionResolvedListeners.add(listener);
    return () => this.#selectionResolvedListeners.delete(listener);
  }

  onCellAttention(listener: CellAttentionListener): () => void {
    this.#cellAttentionListeners.add(listener);
    return () => this.#cellAttentionListeners.delete(listener);
  }

  accept(message: unknown, buffers: readonly DataView[] = []): boolean {
    if (!isRoutedEvent(message)) return false;
    if (buffers.length !== 0) return true;
    if (message.type === "selection.resolved") {
      try {
        const event = parseSelectionResolvedEvent(message);
        for (const listener of this.#selectionResolvedListeners) listener(event);
      } catch {
        // Invalid events remain isolated from the widget interaction state.
      }
      return true;
    }
    try {
      const event =
        message.type === "cell.activity"
          ? parseCellActivityEvent(message)
          : parseCellRevealEvent(message);
      for (const listener of this.#cellAttentionListeners) listener(event);
    } catch {
      // Invalid events remain isolated from the widget interaction state.
    }
    return true;
  }

  clear(): void {
    this.#selectionResolvedListeners.clear();
    this.#cellAttentionListeners.clear();
  }
}

function isRoutedEvent(message: unknown): message is {
  protocol: string;
  type: "selection.resolved" | "cell.activity" | "cell.reveal";
} {
  return (
    typeof message === "object" &&
    message !== null &&
    "protocol" in message &&
    message.protocol === EVENT_PROTOCOL &&
    "type" in message &&
    (message.type === "selection.resolved" ||
      message.type === "cell.activity" ||
      message.type === "cell.reveal")
  );
}
