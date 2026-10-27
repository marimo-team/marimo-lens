import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const notify of listeners) notify();
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Snap to the tick, so every read inside one tick returns the same time.
function snapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

/** The current time, shared by every subscriber and advanced twice a minute. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot);
}
