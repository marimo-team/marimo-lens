import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import type { LensState } from "@/contracts";

import { RevisionSyncTimeoutError, waitForRevision } from "@/conflict";

function state(revision = 0): LensState {
  return {
    revision,
    nextLabel: "S1",
    currentSelectionId: null,
    selections: [],
  };
}

afterEach(() => vi.useRealTimers());

describe("revision synchronization", () => {
  test("resolves after the model reaches the response revision", async () => {
    vi.useFakeTimers();
    const stateRef = { current: state() };
    const waiting = waitForRevision(stateRef, 2, new AbortController().signal);
    stateRef.current = state(2);
    await vi.advanceTimersByTimeAsync(25);
    await expect(waiting).resolves.toBeUndefined();
  });

  test("rejects when the model does not reach the response revision", async () => {
    vi.useFakeTimers();
    const waiting = waitForRevision({ current: state() }, 2, new AbortController().signal);
    const rejection = expect(waiting).rejects.toBeInstanceOf(RevisionSyncTimeoutError);
    await vi.advanceTimersByTimeAsync(5_050);
    await rejection;
  });

  test("aborts polling and clears its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForRevision({ current: state() }, 2, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
