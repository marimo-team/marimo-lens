import { describe, expect, test } from "vitest";

import { createLensUiStore } from "@/store";

describe("copy status store", () => {
  test("does not let an old success reset clear a newer pending copy", () => {
    const store = createLensUiStore("test-copy-status");

    store.getState().startCopy("copy-1", 1);
    store.getState().copySucceeded(2);
    store.getState().startCopy("copy-2", 2);
    store.getState().resetCopyStatus(2);

    expect(store.getState()).toMatchObject({
      copyRequestId: "copy-2",
      copyStartedRevision: 2,
      copyStatus: "pending",
      copied: false,
    });
  });

  test("only resets the matching successful revision", () => {
    const store = createLensUiStore("test-copy-status-revision");

    store.getState().startCopy("copy-1", 1);
    store.getState().copySucceeded(2);
    store.getState().resetCopyStatus(1);
    expect(store.getState().copyStatus).toBe("success");

    store.getState().resetCopyStatus(2);
    expect(store.getState().copyStatus).toBe("idle");
  });
});
