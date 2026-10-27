import { describe, expect, test } from "vite-plus/test";

import { indexRecord } from "@/context/record-index";

import { historyEntryFixture, historyFixture, resolvedEventFixture } from "../support/fixtures";

describe("record index", () => {
  test("lists the requests that shaped a selection, undone ones first", () => {
    const older = historyEntryFixture({
      id: "chat-1",
      resolvedAt: "2026-07-23T07:00:00Z",
      changes: [{ cellId: "cell-net", status: "undone", undoneBy: "chat-2" }],
      shaped: ["selection-1"],
    });
    const newer = historyEntryFixture({
      id: "chat-2",
      resolvedAt: "2026-07-23T08:00:00Z",
      changes: [{ cellId: "cell-net", status: "in_force" }],
      shaped: ["selection-1"],
    });
    const unrelated = historyEntryFixture({ id: "chat-3", resolvedAt: "2026-07-23T09:00:00Z" });

    const record = indexRecord(historyFixture([older, newer, unrelated]));

    expect(record.shaping("selection-1").map(({ id }) => id)).toEqual(["chat-1", "chat-2"]);
    expect(record.shaping("selection-9")).toEqual([]);
    expect(record.entries.map(({ id }) => id)).toEqual(["chat-3", "chat-2", "chat-1"]);
  });

  test("names cells by marimo name, then by what they define, then not at all", () => {
    const record = indexRecord(
      historyFixture([], {
        cells: [
          { id: "named", name: "net_revenue", defines: ["net_revenue"] },
          { id: "unnamed", defines: ["a", "b", "c", "d"] },
          { id: "silent", defines: [] },
        ],
      }),
    );

    const name = (cellId: string) => record.changedCellName({ cellId, status: "in_force" });
    expect(name("named")).toBe("net_revenue");
    expect(name("unnamed")).toBe("a, b, c, …");
    expect(name("silent")).toBe("Unnamed cell");
    expect(name("absent")).toBe("Unnamed cell");
    expect(record.changedCellName({ cellId: "silent", name: "kept", status: "in_force" })).toBe(
      "kept",
    );
    expect(record.changedCellName({ status: "undone" })).toBe("Deleted cell");
    expect(record.changedCellName({ status: "unknown" })).toBe("Cell not found");
  });

  test("names the request that undid a change", () => {
    const chat = historyEntryFixture({
      id: "chat-1",
      channel: "chat",
      note: "Move the net revenue logic into a function so the report can import it",
    });
    delete chat.label;
    const record = indexRecord(historyFixture([historyEntryFixture(), chat]));

    expect(record.requestName("selection-1")).toBe("S1");
    expect(record.requestName("chat-1")).toBe("“Move the net revenue logic into a…”");
    expect(record.requestName("unrecorded")).toBe("an edit made outside Lens");
    expect(record.requestName("gone")).toBe("a later request");
  });

  test("joins a receipt to the resolutions it announces", () => {
    const entry = historyEntryFixture({ resolvedAt: "2026-07-23T08:00:00Z" });
    const event = resolvedEventFixture({ resolvedAt: entry.resolvedAt });

    expect(indexRecord(historyFixture([entry])).resolution(event)).toEqual([entry]);
    expect(indexRecord(null).resolution(event)).toEqual([]);
  });
});
