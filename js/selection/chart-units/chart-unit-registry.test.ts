import { describe, expect, test } from "vitest";
import { defineChartUnitAdapter } from "@/selection/chart-units/chart-unit-adapter";
import {
  createChartUnitRegistry,
  resolveChartUnit,
} from "@/selection/chart-units/chart-unit-registry";
import type { LensTarget } from "@/types";

const chartTarget: LensTarget = {
  id: "var:chart",
  variable: "chart",
  label: "chart",
  kind: "visualization",
  capabilities: { chartPart: true, visualSurface: true },
  chart: {
    library: "custom",
    parts: [
      {
        library: "custom",
        kind: "axis",
        label: "custom axis",
        selector: "[data-custom-axis]",
      },
    ],
  },
};

describe("chart unit registry", () => {
  test("resolves with a custom registry", () => {
    document.body.innerHTML = `<div data-custom-chart><span>point</span></div>`;
    const element = document.querySelector("[data-custom-chart]")!;
    const registry = createChartUnitRegistry([
      defineChartUnitAdapter({
        id: "custom-chart",
        match: ({ element }) =>
          element.matches("[data-custom-chart]")
            ? {
                element,
                unit: {
                  library: "custom",
                  kind: "mark",
                  label: "custom mark",
                },
                score: 99,
              }
            : null,
      }),
    ]);

    const match = registry.resolve(element, undefined, chartTarget);

    expect(registry.adapters.map((adapter) => adapter.id)).toEqual(["custom-chart"]);
    expect(match?.unit).toMatchObject({ library: "custom", label: "custom mark" });
  });

  test("uses Python-emitted chart unit selectors", () => {
    document.body.innerHTML = `
      <section>
        <div data-custom-axis><span>Quarter</span></div>
      </section>
    `;
    const label = document.querySelector("span")!;

    const match = resolveChartUnit(label, undefined, chartTarget);

    expect(match?.unit).toMatchObject({
      library: "custom",
      kind: "axis",
      label: "custom axis",
      selector: "[data-custom-axis]",
    });
    expect(match?.context).toMatchObject({
      selector: "[data-custom-axis]",
      source: "chart-metadata",
    });
  });
});
