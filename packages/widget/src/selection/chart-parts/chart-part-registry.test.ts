import { describe, expect, test } from "vite-plus/test";

import type { LensTarget } from "@/types";

import { defineChartPartAdapter } from "@/selection/chart-parts/chart-part-adapter";
import {
  createChartPartRegistry,
  resolveChartPart,
} from "@/selection/chart-parts/chart-part-registry";
import { setRect } from "@/selection/selection-registry-fixtures";

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

describe("chart part registry", () => {
  test("resolves with a custom registry", () => {
    document.body.innerHTML = `<div data-custom-chart><span>point</span></div>`;
    const element = document.querySelector("[data-custom-chart]")!;
    const registry = createChartPartRegistry([
      defineChartPartAdapter({
        id: "custom-chart",
        match: ({ element }) =>
          element.matches("[data-custom-chart]")
            ? {
                element,
                part: {
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
    expect(match?.part).toMatchObject({ library: "custom", label: "custom mark" });
  });

  test("uses Python-emitted chart part selectors", () => {
    document.body.innerHTML = `
      <section>
        <div data-custom-axis><span>Quarter</span></div>
      </section>
    `;
    const label = document.querySelector("span")!;

    const match = resolveChartPart(label, undefined, chartTarget);

    expect(match?.part).toMatchObject({
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

  test("metadata selector matching prefers nearest specific selector", () => {
    document.body.innerHTML = `
      <svg data-chart-root>
        <g data-axis><text>Quarter</text></g>
      </svg>
    `;
    const label = document.querySelector("text")!;
    const target: LensTarget = {
      ...chartTarget,
      chart: {
        library: "custom",
        parts: [
          {
            library: "custom",
            kind: "plot-area",
            label: "chart root",
            selector: "[data-chart-root]",
          },
          {
            library: "custom",
            kind: "axis",
            label: "x axis",
            selector: "[data-axis]",
          },
        ],
      },
    };

    const match = resolveChartPart(label, undefined, target);

    expect(match?.part).toMatchObject({ kind: "axis", label: "x axis" });
  });

  test("metadata selector matching prefers specificity for the same element", () => {
    document.body.innerHTML = `
      <svg data-chart-root>
        <rect id="bar" data-mark></rect>
      </svg>
    `;
    const bar = document.querySelector("rect")!;
    const target: LensTarget = {
      ...chartTarget,
      chart: {
        library: "custom",
        parts: [
          {
            library: "custom",
            kind: "plot-area",
            label: "broad data mark",
            selector: "svg [data-mark]",
          },
          {
            library: "custom",
            kind: "mark",
            label: "specific bar",
            selector: "#bar",
          },
        ],
      },
    };

    const match = resolveChartPart(bar, undefined, target);

    expect(match?.part).toMatchObject({ kind: "mark", label: "specific bar" });
  });

  test("generic SVG fallback still applies to custom chart libraries", () => {
    document.body.innerHTML = `
      <svg>
        <rect data-category="Q4"></rect>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    const bar = document.querySelector("rect")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    setRect(bar, { height: 120, width: 80, x: 80, y: 90 });
    const target: LensTarget = {
      ...chartTarget,
      chart: { library: "custom" },
    };

    const match = resolveChartPart(bar, undefined, target);

    expect(match?.adapterId).toBe("generic-svg");
    expect(match?.part).toMatchObject({
      datum: { category: "Q4" },
      kind: "mark",
      library: "visual",
    });
  });

  test("renderer hits beat broad metadata selectors", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <svg>
          <g class="scatterlayer">
            <g class="trace scatter">
              <g class="points"><path class="point"></path></g>
            </g>
          </g>
        </svg>
      </div>
    `;
    const point = document.querySelector("path.point")!;
    setRect(point, { height: 6, width: 6, x: 116, y: 118 });
    const target: LensTarget = {
      ...chartTarget,
      chart: {
        library: "plotly",
        parts: [
          {
            library: "plotly",
            kind: "plot-area",
            label: "metadata plot area",
            selector: ".js-plotly-plot",
          },
        ],
      },
    };

    const match = resolveChartPart(point, { x: 119, y: 121 }, target);

    expect(match?.adapterId).toBe("plotly");
    expect(match?.part).toMatchObject({ kind: "trace", library: "plotly" });
  });

  test("renderer legend hits beat broad metadata selectors", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <svg>
          <g class="legend"><g class="traces"><text>North</text></g></g>
        </svg>
      </div>
    `;
    const legend = document.querySelector(".traces")!;
    const target: LensTarget = {
      ...chartTarget,
      chart: {
        library: "plotly",
        parts: [
          {
            library: "plotly",
            kind: "plot-area",
            label: "metadata plot area",
            selector: ".js-plotly-plot",
          },
        ],
      },
    };

    const match = resolveChartPart(legend, undefined, target);

    expect(match?.adapterId).toBe("plotly");
    expect(match?.part).toMatchObject({ kind: "legend", library: "plotly" });
  });
});
