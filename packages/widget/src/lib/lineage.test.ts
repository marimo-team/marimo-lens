import { describe, expect, test } from "vite-plus/test";

import type { LensTarget, NotebookGraph } from "@/types";

import { lineageForTarget } from "@/lib/lineage";

const graph: NotebookGraph = {
  available: true,
  cells: [
    { id: "imports", defs: [], refs: [] },
    { id: "data", defs: ["sales"], refs: ["pd"] },
    { id: "summary", defs: ["summary"], refs: ["sales"] },
    { id: "chart", defs: ["chart"], refs: ["summary"] },
    { id: "display", defs: [], refs: ["sales", "chart"] },
  ],
  edges: [
    { from: "imports", to: "data" },
    { from: "data", to: "summary" },
    { from: "summary", to: "chart" },
    { from: "chart", to: "display" },
    { from: "data", to: "display" },
  ],
};

describe("lineageForTarget", () => {
  test("summarizes transitive upstream and downstream cells", () => {
    const target: LensTarget = {
      id: "var:summary",
      label: "summary",
      kind: "dataframe",
      cellId: "summary",
    };

    const lineage = lineageForTarget(target, graph);

    expect(lineage.available).toBe(true);
    expect(lineage.focusCellIds).toEqual(["summary"]);
    expect(lineage.upstreamCellIds).toEqual(["data", "imports"]);
    expect(lineage.downstreamCellIds).toEqual(["chart", "display"]);
  });

  test("prefers the primary target cell over display and related cells", () => {
    const target: LensTarget = {
      id: "var:sales",
      label: "sales",
      kind: "dataframe",
      cellId: "data",
      displayCellIds: ["display"],
      relatedCellIds: ["summary"],
    };

    const lineage = lineageForTarget(target, graph, "display");

    expect(lineage.focusCellIds).toEqual(["data"]);
    expect(lineage.upstreamCellIds).toEqual(["imports"]);
    expect(lineage.downstreamCellIds).toEqual(["summary", "display", "chart"]);
  });

  test("falls back to the display cell when the target has no primary cell", () => {
    const target: LensTarget = {
      id: "var:display_only",
      label: "display_only",
      kind: "object",
      displayCellIds: ["display"],
    };

    const lineage = lineageForTarget(target, graph);

    expect(lineage.focusCellIds).toEqual(["display"]);
    expect(lineage.upstreamCellIds).toEqual(["chart", "data", "summary", "imports"]);
    expect(lineage.downstreamCellIds).toEqual([]);
  });

  test("keeps focus identity when the graph is unavailable", () => {
    const target: LensTarget = {
      id: "var:sales",
      label: "sales",
      kind: "dataframe",
      cellId: "data",
    };

    const lineage = lineageForTarget(target, {});

    expect(lineage).toEqual({
      available: false,
      focusCellIds: ["data"],
      upstreamCellIds: [],
      downstreamCellIds: [],
    });
  });
});
