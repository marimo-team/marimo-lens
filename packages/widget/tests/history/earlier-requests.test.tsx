import { afterEach, describe, expect, test } from "vite-plus/test";

import { EarlierRequests } from "@/history/earlier-requests";

import { historyEntryFixture, historyFixture, selectionFixture } from "../support/fixtures";
import { LensTestProvider, lensState } from "../support/lens";
import { render } from "../support/render";

afterEach(() => {
  document.body.replaceChildren();
});

describe("earlier requests", () => {
  test("lists the requests that changed what a selection shows, undone ones first", () => {
    const selection = selectionFixture();
    const refactor = historyEntryFixture({
      id: "chat-2",
      channel: "chat",
      note: "Move the net revenue logic into a function.",
      resolvedAt: "2026-07-23T08:00:00Z",
      changes: [{ cellId: "cell-net", status: "in_force" }],
      shaped: [selection.id],
    });
    const correction = historyEntryFixture({
      id: "selection-7",
      label: "S7",
      note: "Add the 37,800 of C3 sales that the outage dropped.",
      resolvedAt: "2026-07-23T07:00:00Z",
      changes: [{ cellId: "cell-net", status: "undone", undoneBy: "chat-2" }],
      shaped: [selection.id],
    });
    delete refactor.label;
    renderRequests(
      selection,
      historyFixture([correction, refactor], {
        cells: [{ id: "cell-net", name: "net_revenue", defines: ["net_revenue"] }],
      }),
    );

    const section = document.querySelector("[data-marimo-lens-earlier-requests]");
    expect(section?.getAttribute("aria-label")).toBe("Earlier requests that changed what S1 shows");
    const rows = Array.from(section?.querySelectorAll("li") ?? []);
    const items = rows.map((item) => item.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]?.startsWith("S7")).toBe(true);
    expect(rows[1]?.querySelector('svg[aria-label="Chat request"]')).not.toBeNull();
    expect(items[0]).toContain("Undone");
    expect(items[0]).toContain(correction.note);
    expect(items[0]).toContain("undone by “Move the net revenue logic into a…”");
    expect(items[1]).toContain("Still applied");
    expect(items[1]).toContain("net_revenue");
  });

  test("shows nothing when no earlier request changed what the selection shows", () => {
    renderRequests(selectionFixture(), historyFixture([historyEntryFixture()]));

    expect(document.querySelector("[data-marimo-lens-earlier-requests]")).toBeNull();
  });
});

function renderRequests(
  selection: ReturnType<typeof selectionFixture>,
  history: ReturnType<typeof historyFixture>,
) {
  render(
    <LensTestProvider state={lensState({ selections: [selection], history })}>
      <EarlierRequests selection={selection} />
    </LensTestProvider>,
  );
}
