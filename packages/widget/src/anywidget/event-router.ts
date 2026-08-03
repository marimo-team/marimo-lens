import type { CellAttentionEvent, SelectionResolvedEvent } from "@marimo-lens/protocol";

import {
  parseCellActivityStartEvent,
  parseCellActivityStopEvent,
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
      let event: SelectionResolvedEvent;
      try {
        event = parseSelectionResolvedEvent(message);
      } catch {
        return true;
      }
      dispatch(this.#selectionResolvedListeners, event);
      return true;
    }
    let event: CellAttentionEvent;
    try {
      event =
        message.type === "cell.activity.start"
          ? parseCellActivityStartEvent(message)
          : message.type === "cell.activity.stop"
            ? parseCellActivityStopEvent(message)
            : parseCellRevealEvent(message);
    } catch {
      return true;
    }
    dispatch(this.#cellAttentionListeners, event);
    return true;
  }

  clear(): void {
    this.#selectionResolvedListeners.clear();
    this.#cellAttentionListeners.clear();
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

function isRoutedEvent(message: unknown): message is {
  protocol: string;
  type: "selection.resolved" | "cell.activity.start" | "cell.activity.stop" | "cell.reveal";
} {
  return (
    typeof message === "object" &&
    message !== null &&
    "protocol" in message &&
    message.protocol === EVENT_PROTOCOL &&
    "type" in message &&
    (message.type === "selection.resolved" ||
      message.type === "cell.activity.start" ||
      message.type === "cell.activity.stop" ||
      message.type === "cell.reveal")
  );
}
