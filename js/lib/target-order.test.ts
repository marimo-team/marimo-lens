import { afterEach, describe, expect, test } from "vitest";

import type { LensTarget, NotebookGraph } from "@/types";

import { orderedTargets } from "@/lib/target-order";

describe("orderedTargets", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("uses notebook graph cell order instead of target kind or name order", () => {
    const targets = [
      target({ id: "later-table", label: "aaa_table", kind: "table", cellId: "cell-b" }),
      target({ id: "first-object", label: "zzz_object", kind: "object", cellId: "cell-a" }),
    ];

    expect(orderedTargets(targets, graph(["cell-a", "cell-b"])).map((item) => item.id)).toEqual([
      "first-object",
      "later-table",
    ]);
  });

  test("uses column-major live notebook layout when cells are measurable", () => {
    mockCell("cell-right-top", { left: 360, top: 16 });
    mockCell("cell-left-bottom", { left: 24, top: 180 });
    mockCell("cell-right-bottom", { left: 360, top: 140 });
    mockCell("cell-left-top", { left: 24, top: 28 });

    const targets = [
      target({ id: "right-top", label: "right top", displayCellIds: ["cell-right-top"] }),
      target({ id: "left-bottom", label: "left bottom", displayCellIds: ["cell-left-bottom"] }),
      target({ id: "right-bottom", label: "right bottom", displayCellIds: ["cell-right-bottom"] }),
      target({ id: "left-top", label: "left top", displayCellIds: ["cell-left-top"] }),
    ];

    expect(
      orderedTargets(
        targets,
        graph(["cell-right-top", "cell-left-bottom", "cell-right-bottom", "cell-left-top"]),
      ).map((item) => item.id),
    ).toEqual(["left-top", "left-bottom", "right-top", "right-bottom"]);
  });

  test("keeps output targets in cell output reference order", () => {
    const targets = [
      target({ id: "first", label: "first", variable: "first", cellId: "cell-a" }),
      target({ id: "second", label: "second", variable: "second", cellId: "cell-a" }),
    ];

    expect(
      orderedTargets(targets, graph([{ id: "cell-a", outputRefs: ["second", "first"] }])).map(
        (item) => item.id,
      ),
    ).toEqual(["second", "first"]);
  });

  test("falls back to topological edge order when graph cells are unavailable", () => {
    const targets = [
      target({ id: "child", label: "child", cellId: "cell-c" }),
      target({ id: "parent", label: "parent", cellId: "cell-a" }),
      target({ id: "middle", label: "middle", cellId: "cell-b" }),
    ];

    expect(
      orderedTargets(targets, {
        edges: [
          { from: "cell-a", to: "cell-b" },
          { from: "cell-b", to: "cell-c" },
        ],
      }).map((item) => item.id),
    ).toEqual(["parent", "middle", "child"]);
  });
});

type GraphCellFixture = string | { id: string; outputRefs?: string[] };

function graph(cells: GraphCellFixture[]): NotebookGraph {
  return {
    cells: cells.map((cell) => {
      const fixture = typeof cell === "string" ? { id: cell } : cell;
      return {
        id: fixture.id,
        defs: [],
        refs: [],
        outputRefs: fixture.outputRefs,
      };
    }),
  };
}

function target(overrides: Partial<LensTarget> & Pick<LensTarget, "id" | "label">): LensTarget {
  return {
    kind: "object",
    ...overrides,
  };
}

function mockCell(cellId: string, rect: { left: number; top: number }) {
  const element = document.createElement("section");
  element.id = `output-${cellId}`;
  element.getBoundingClientRect = () => new DOMRect(rect.left, rect.top, 280, 96);
  document.body.append(element);
}
