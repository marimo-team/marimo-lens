import { describe, expect, test } from "vite-plus/test";

import { reopenTarget } from "@/history/entries";

import { historyEntryFixture } from "../support/fixtures";

describe("History reopen target", () => {
  test("moves the followed target into the asking document", () => {
    const entry = historyEntryFixture();

    expect(reopenTarget(entry, document)).toMatchObject({
      kind: "notebook",
      cellIds: ["cell-1"],
      documentPath: "/",
    });
  });

  test("reopens nothing when a recorded cell is gone", () => {
    // Python names no current cell, and the recorded ID may now belong to
    // another cell after marimo renumbered the notebook.
    const entry = historyEntryFixture({ cellIds: [] });

    expect(reopenTarget(entry, document)).toBeNull();
  });

  test("reopens nothing for a chat request", () => {
    const entry = historyEntryFixture({ channel: "chat", label: undefined, selection: undefined });

    expect(reopenTarget(entry, document)).toBeNull();
  });
});
