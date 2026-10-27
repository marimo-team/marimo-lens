import { afterEach, describe, expect, test } from "vite-plus/test";

import type { LensState } from "@/context/lens-context";

import { ResolutionReceipt } from "@/transient/resolution-receipt";

import {
  historyEntryFixture,
  historyFixture,
  resolvedEventFixture,
  selectionFixture,
} from "../support/fixtures";
import { LensTestProvider, lensActions, lensState } from "../support/lens";
import { NotebookDomTestProvider } from "../support/notebook-dom";
import { render } from "../support/render";

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolution receipt", () => {
  test("names each cell a batch changed once, with whether the change holds", () => {
    const second = selectionFixture({ id: "selection-2", label: "S2" });
    const resolvedAt = "2026-07-23T08:00:00Z";
    const event = resolvedEventFixture({
      revision: 6,
      selections: [selectionFixture(), second],
      resolvedAt,
    });
    const history = historyFixture(
      [
        historyEntryFixture({
          resolvedAt,
          changes: [{ cellId: "cell-net", status: "in_force" }],
        }),
        historyEntryFixture({
          id: second.id,
          label: "S2",
          resolvedAt,
          changes: [
            { cellId: "cell-net", status: "in_force" },
            { cellId: "cell-chart", status: "in_force" },
          ],
        }),
      ],
      {
        cells: [
          { id: "cell-net", name: "net_revenue", defines: ["net_revenue"] },
          { id: "cell-chart", defines: ["revenue_chart"] },
        ],
      },
    );
    renderReceipt(lensState({ history, receipt: event }));

    expect(document.querySelector("[data-marimo-lens-receipt-changes]")?.textContent).toBe(
      "Changednet_revenue, still appliedrevenue_chart, still appliedView in History",
    );
  });
});

function renderReceipt(state: LensState) {
  render(
    <NotebookDomTestProvider>
      <LensTestProvider state={state} actions={lensActions()}>
        <ResolutionReceipt onReveal={() => {}} onRefocus={() => {}} />
      </LensTestProvider>
    </NotebookDomTestProvider>,
  );
}
