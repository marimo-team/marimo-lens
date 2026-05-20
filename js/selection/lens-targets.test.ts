import { describe, expect, test } from "vitest";
import { normalizeLensTargets } from "@/selection/lens-targets";
import type { LensChartPart, LensTarget, LensTargetKind } from "@/types";

describe("normalizeLensTargets", () => {
  test("accepts coarse output target kinds", () => {
    const kinds: LensTargetKind[] = ["media", "document", "data", "layout", "diagnostic", "output"];
    const targets: LensTarget[] = kinds.map((kind) => ({
      id: `${kind}:demo`,
      label: kind,
      kind,
    }));

    expect(normalizeLensTargets(targets).map((target) => target.kind)).toEqual(kinds);
  });

  test("rejects unknown target contract keys", () => {
    expect(() =>
      normalizeLensTargets([
        {
          id: "var:sales",
          label: "sales",
          kind: "dataframe",
          capabilities: { sortable: true } as unknown as LensTarget["capabilities"],
        },
      ]),
    ).toThrow(/unknown capability/);

    expect(() =>
      normalizeLensTargets([
        {
          id: "var:sales",
          label: "sales",
          kind: "dataframe",
          selectionPolicy: {
            prefer: ["magic"] as unknown as NonNullable<LensTarget["selectionPolicy"]>["prefer"],
          },
        },
      ]),
    ).toThrow(/unknown selection surface/);

    expect(() =>
      normalizeLensTargets([
        {
          id: "var:chart",
          label: "chart",
          kind: "visualization",
          chart: {
            library: "custom",
            parts: [
              {
                library: "custom",
                kind: "tooltip",
                label: "tooltip",
              } as unknown as LensChartPart,
            ],
          },
        },
      ]),
    ).toThrow(/unknown chart unit kind/);

    expect(() =>
      normalizeLensTargets([
        {
          id: "var:sales",
          label: "sales",
          kind: "dataframe",
          selectionModel: {
            units: [{ id: "broken" }],
          } as unknown as LensTarget["selectionModel"],
        },
      ]),
    ).toThrow(/selectionModel unit 0 is missing kind/);
  });

  test("accepts semantic selection model units", () => {
    const [target] = normalizeLensTargets([
      {
        id: "var:sales",
        label: "sales",
        kind: "dataframe",
        selectionModel: {
          defaultFallback: "column",
          units: [
            {
              kind: "column",
              id: "col:revenue",
              label: "revenue",
              fallbackFor: ["cell", "summary-stat", "dtype-label"],
            },
            {
              kind: "cell",
              supported: false,
              requires: ["rowId", "column"],
            },
          ],
        },
      },
    ]);

    expect(target.selectionModel?.defaultFallback).toBe("column");
    expect(target.selectionModel?.units[0]).toMatchObject({
      kind: "column",
      id: "col:revenue",
    });
  });
});
