import { describe, expect, test } from "vitest";

import type { LensTarget } from "@/types";

import { resolveElementSelection } from "@/selection/selection-registry";
import { chartTarget, dataframeTarget, setRect } from "@/selection/selection-registry-fixtures";

describe("resolveElementSelection chart surfaces", () => {
  test("resolves Vega and Altair axis groups as chart parts", () => {
    document.body.innerHTML = `
      <div id="output-chart-cell">
        <svg>
          <g class="role-axis">
            <g class="mark-text role-axis-label"><text>Quarter</text></g>
          </g>
        </svg>
      </div>
    `;
    const axis = document.querySelector(".role-axis")!;
    setRect(axis);

    const resolved = resolveElementSelection(axis, [
      { ...chartTarget, displayCellIds: ["chart-cell"] },
    ]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      kind: "axis",
      library: "vega",
    });
    expect(resolved?.displayCellId).toBe("chart-cell");
  });

  test("prefers variable chart semantics over output targets for chart parts", () => {
    document.body.innerHTML = `
      <div id="output-chart-cell">
        <svg>
          <g class="role-axis">
            <g class="mark-text role-axis-label"><text>Quarter</text></g>
          </g>
        </svg>
      </div>
    `;
    const axis = document.querySelector(".role-axis")!;
    setRect(axis);
    const chartParts = {
      library: "altair" as const,
      parts: [{ library: "altair" as const, kind: "axis" as const, label: "x axis" }],
    };

    const resolved = resolveElementSelection(axis, [
      { ...chartTarget, displayCellIds: ["chart-cell"], chart: chartParts },
      {
        ...chartTarget,
        id: "output:chart-cell",
        variable: undefined,
        label: "Chart output from cell chart-cell",
        kind: "output",
        cellId: "chart-cell",
        displayCellIds: ["chart-cell"],
        chart: chartParts,
      },
    ]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.target.id).toBe("var:chart");
  });

  test("visual fallback highlights the resolved visual surface", () => {
    document.body.innerHTML = `
      <div class="vega-embed">
        <svg><g><text>chart label</text></g></svg>
      </div>
    `;
    const svg = document.querySelector("svg")!;
    const label = document.querySelector("text")!;
    setRect(svg, { height: 180, width: 240, x: 20, y: 30 });
    setRect(label, { height: 12, width: 70, x: 50, y: 60 });

    const resolved = resolveElementSelection(label, [
      { ...chartTarget, capabilities: { visualSurface: true } },
    ]);

    expect(resolved?.selection?.adapter).toBe("visual-surface");
    expect(resolved?.element).toBe(svg);
  });

  test("resolves Vega canvas regions with chart metadata", () => {
    document.body.innerHTML = `
      <div class="vega-embed">
        <canvas class="marks"></canvas>
      </div>
    `;
    const canvas = document.querySelector("canvas")!;
    setRect(canvas, { height: 240, width: 320, x: 20, y: 30 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [canvas];

    try {
      const resolved = resolveElementSelection(
        canvas,
        [
          {
            ...chartTarget,
            chart: {
              library: "altair",
              parts: [
                { library: "altair", kind: "axis", label: "x axis", detail: "quarter" },
                { library: "altair", kind: "axis", label: "y axis", detail: "revenue" },
                { library: "altair", kind: "legend", label: "color legend", detail: "region" },
                { library: "altair", kind: "mark", label: "bar" },
              ],
            },
          },
        ],
        { x: 180, y: 120 },
      );

      expect(resolved?.selection?.adapter).toBe("chart-part");
      expect(resolved?.chartPart).toMatchObject({
        kind: "mark",
        label: "bar",
        library: "altair",
      });
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("resolves faceted Vega canvas title, headers, and local panel marks", () => {
    document.body.innerHTML = `
      <div class="vega-embed">
        <canvas class="marks"></canvas>
      </div>
    `;
    const canvas = document.querySelector("canvas")!;
    setRect(canvas, { height: 600, width: 400, x: 20, y: 30 });
    const target: LensTarget = {
      ...chartTarget,
      chart: {
        library: "altair",
        parts: [
          {
            library: "altair",
            kind: "title",
            label: "Faceted site yield",
            detail: "chart title",
          },
          {
            library: "altair",
            kind: "facet",
            label: "column facet",
            detail: "site",
            channel: "column",
            field: "site",
            orientation: "column",
            context: { values: ["Crookston", "Morris"], count: 2 },
          },
          {
            library: "altair",
            kind: "facet",
            label: "row facet",
            detail: "variety",
            channel: "row",
            field: "variety",
            orientation: "row",
            context: { values: ["Manchuria", "Velvet", "Trebi"], count: 3 },
          },
          { library: "altair", kind: "axis", label: "x axis", detail: "year_label" },
          { library: "altair", kind: "axis", label: "y axis", detail: "yield_amount" },
          { library: "altair", kind: "legend", label: "color legend", detail: "variety" },
          { library: "altair", kind: "mark", label: "bar" },
        ],
      },
    };

    const title = resolveElementSelection(canvas, [target], { x: 190, y: 42 });
    const columnFacet = resolveElementSelection(canvas, [target], { x: 160, y: 66 });
    const rowFacet = resolveElementSelection(canvas, [target], { x: 48, y: 150 });
    const mark = resolveElementSelection(canvas, [target], { x: 170, y: 220 });

    expect(title?.chartPart).toMatchObject({
      kind: "title",
      label: "Faceted site yield",
    });
    expect(columnFacet?.chartPart).toMatchObject({
      kind: "facet",
      channel: "column",
      field: "site",
    });
    expect(columnFacet?.context).toMatchObject({
      columnValue: "Crookston",
      region: "column-facet",
    });
    expect(rowFacet?.chartPart).toMatchObject({
      kind: "facet",
      channel: "row",
      field: "variety",
    });
    expect(rowFacet?.context).toMatchObject({
      region: "row-facet",
      rowValue: "Manchuria",
    });
    expect(mark?.chartPart).toMatchObject({
      kind: "mark",
      label: "bar",
    });
    expect(mark?.rect.height).toBeLessThan(220);
    expect(mark?.context).toMatchObject({
      columnValue: "Crookston",
      region: "facet-panel",
      rowValue: "Manchuria",
    });
  });

  test("resolves Vega SVG title and facet header text as semantic chart parts", () => {
    document.body.innerHTML = `
      <div id="output-chart-cell">
        <div class="vega-embed">
          <svg>
            <g class="role-title"><text>Faceted site yield</text></g>
            <g class="role-column-header">
              <g class="role-title"><text>Crookston</text></g>
            </g>
          </svg>
        </div>
      </div>
    `;
    const titleGroup = document.querySelector("g.role-title")!;
    const titleText = titleGroup.querySelector("text")!;
    const svg = document.querySelector("svg")!;
    const facetHeader = document.querySelector("g.role-column-header")!;
    const facetText = facetHeader.querySelector("text")!;
    setRect(svg, { height: 160, width: 260, x: 20, y: 10 });
    setRect(titleGroup, { height: 18, width: 160, x: 80, y: 20 });
    setRect(facetHeader, { height: 20, width: 80, x: 120, y: 54 });

    const target: LensTarget = {
      ...chartTarget,
      displayCellIds: ["chart-cell"],
      chart: {
        library: "altair",
        parts: [
          { library: "altair", kind: "title", label: "Faceted site yield" },
          {
            library: "altair",
            kind: "facet",
            label: "column facet",
            detail: "site",
            channel: "column",
            field: "site",
          },
        ],
      },
    };

    const title = resolveElementSelection(titleText, [target]);
    const titleFromSvgPoint = resolveElementSelection(svg, [target], { x: 120, y: 28 });
    const facet = resolveElementSelection(facetText, [target]);

    expect(title?.chartPart).toMatchObject({
      kind: "title",
      label: "Faceted site yield",
    });
    expect(titleFromSvgPoint?.chartPart).toMatchObject({
      kind: "title",
      label: "Faceted site yield",
    });
    expect(facet?.chartPart).toMatchObject({
      kind: "facet",
      channel: "column",
      field: "site",
    });
  });

  test("treats marimo data explorer Vega canvas clicks as chart parts before columns", () => {
    document.body.innerHTML = `
      <section id="output-explorer">
        <marimo-data-explorer>
          <div class="vega-embed"><canvas class="marks"></canvas></div>
        </marimo-data-explorer>
      </section>
    `;
    const canvas = document.querySelector("canvas")!;
    setRect(canvas, { height: 240, width: 320, x: 20, y: 30 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [canvas];

    try {
      const resolved = resolveElementSelection(
        canvas,
        [
          {
            ...dataframeTarget,
            id: "var:sales_explorer",
            variable: "sales_explorer",
            label: "sales_explorer",
            kind: "visualization",
            component: "marimo-data-explorer",
            columns: [
              { name: "quarter", dtype: "str" },
              { name: "revenue", dtype: "int64" },
            ],
            chart: {
              library: "marimo-data-explorer",
              parts: [
                { library: "marimo-data-explorer", kind: "plot-area", label: "data explorer" },
              ],
            },
            capabilities: { chartPart: true, columnarGrid: true, visualSurface: true },
            selectionPolicy: {
              prefer: ["chart-part", "columnar-grid", "visual-surface", "selector"],
            },
          },
        ],
        { x: 180, y: 120 },
      );

      expect(resolved?.selection?.adapter).toBe("chart-part");
      expect(resolved?.selection?.kind).toBe("mark");
      expect(resolved?.chartPart).toMatchObject({
        kind: "mark",
        library: "vega",
      });
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("resolves Plotly legends as chart parts", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <svg>
          <g class="legend">
            <g class="traces"><text>North</text></g>
          </g>
        </svg>
      </div>
    `;
    const legend = document.querySelector(".traces")!;
    setRect(legend);

    const resolved = resolveElementSelection(legend, [chartTarget]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      kind: "legend",
      library: "plotly",
    });
  });

  test("does not use generic SVG fallback for known chart chrome icons", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <svg class="modebar-btn"><path d="M0 0L8 8"></path></svg>
      </div>
    `;
    const icon = document.querySelector("path")!;
    setRect(icon, { height: 8, width: 8, x: 10, y: 10 });

    const resolved = resolveElementSelection(icon, [
      { ...chartTarget, chart: { library: "plotly" } },
    ]);

    expect(resolved?.selection?.adapter).not.toBe("chart-part");
  });

  test("does not use generic SVG fallback for chart chrome without library metadata", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <div class="modebar"><svg><path d="M0 0L8 8"></path></svg></div>
      </div>
    `;
    const icon = document.querySelector("path")!;
    setRect(icon, { height: 8, width: 8, x: 10, y: 10 });

    const resolved = resolveElementSelection(icon, [chartTarget]);

    expect(resolved?.selection?.adapter).not.toBe("chart-part");
  });

  test("does not use generic SVG fallback for shadow-wrapped chart chrome", () => {
    document.body.innerHTML = `<div class="toolbar"><span id="icon-host"></span></div>`;
    const host = document.querySelector("#icon-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<svg><path d="M0 0L8 8"></path></svg>`;
    const icon = shadow.querySelector("path")!;
    setRect(icon, { height: 8, width: 8, x: 10, y: 10 });

    const resolved = resolveElementSelection(icon, [chartTarget]);

    expect(resolved?.selection?.adapter).not.toBe("chart-part");
  });

  test("resolves Plotly points under the drag overlay by viewport point", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <svg>
          <g class="scatterlayer">
            <g class="trace scatter">
              <g class="points"><path class="point"></path></g>
            </g>
          </g>
          <g class="draglayer"><rect class="nsewdrag drag"></rect></g>
        </svg>
      </div>
    `;
    const point = document.querySelector("path.point")!;
    const drag = document.querySelector(".nsewdrag")!;
    setRect(point, { height: 6, width: 6, x: 116, y: 118 });
    setRect(drag, { height: 180, width: 260, x: 40, y: 60 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [drag];

    try {
      const resolved = resolveElementSelection(
        drag,
        [
          {
            ...chartTarget,
            id: "var:plotly_widget",
            variable: "plotly_widget",
            label: "plotly_widget",
            chart: { library: "plotly" },
          },
        ],
        { x: 119, y: 121 },
      );

      expect(resolved?.selection?.adapter).toBe("chart-part");
      expect(resolved?.chartPart).toMatchObject({
        kind: "trace",
        library: "plotly",
        label: "scatter trace",
      });
      expect(resolved?.element).toBe(point);
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("resolves Plotly annotations as annotations", () => {
    document.body.innerHTML = `
      <div class="js-plotly-plot">
        <svg>
          <g class="annotation"><text>Note</text></g>
        </svg>
      </div>
    `;
    const annotation = document.querySelector(".annotation")!;
    setRect(annotation, { height: 20, width: 60, x: 80, y: 90 });

    const resolved = resolveElementSelection(annotation, [
      { ...chartTarget, chart: { library: "plotly" } },
    ]);

    expect(resolved?.chartPart).toMatchObject({
      kind: "annotation",
      library: "plotly",
    });
  });

  test("resolves Matplotlib SVG marks as chart parts", () => {
    document.body.innerHTML = `
      <svg>
        <g id="figure_1">
          <g id="axes_1">
            <g id="line2d_12"><path d="M0 0L10 10"></path></g>
          </g>
        </g>
      </svg>
    `;
    const path = document.querySelector("path")!;
    setRect(path);

    const resolved = resolveElementSelection(path, [chartTarget]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      kind: "mark",
      library: "matplotlib",
      label: "line",
    });
  });

  test("resolves Matplotlib canvas axes, marks, and legends from pixel bounds", () => {
    document.body.innerHTML = `
      <marimo-matplotlib data-axes-pixel-bounds="[70,36,420,206]">
        <canvas class="block cursor-crosshair" width="550" height="270"></canvas>
      </marimo-matplotlib>
    `;
    const canvas = document.querySelector("canvas")!;
    setRect(canvas, { height: 270, width: 550, x: 20, y: 30 });

    const baseTarget: LensTarget = {
      ...chartTarget,
      chart: {
        library: "matplotlib",
        parts: [
          { library: "matplotlib", kind: "axis", label: "x axis", detail: "Quarter" },
          { library: "matplotlib", kind: "axis", label: "y axis", detail: "Revenue" },
          { library: "matplotlib", kind: "legend", label: "legend" },
          { library: "matplotlib", kind: "mark", label: "patches", detail: "16" },
        ],
      },
    };

    const mark = resolveElementSelection(canvas, [baseTarget], { x: 220, y: 120 });
    const xAxis = resolveElementSelection(canvas, [baseTarget], { x: 220, y: 250 });
    const yAxis = resolveElementSelection(canvas, [baseTarget], { x: 52, y: 120 });
    const legend = resolveElementSelection(canvas, [baseTarget], { x: 488, y: 78 });

    expect(mark?.chartPart).toMatchObject({ kind: "mark", library: "matplotlib" });
    expect(xAxis?.chartPart).toMatchObject({ kind: "axis", label: "x axis" });
    expect(yAxis?.chartPart).toMatchObject({ kind: "axis", label: "y axis" });
    expect(legend?.chartPart).toMatchObject({ kind: "legend", library: "matplotlib" });
  });

  test("resolves Matplotlib canvas chart parts without test-only pixel bounds", () => {
    document.body.innerHTML = `
      <marimo-matplotlib>
        <canvas class="block cursor-crosshair" width="550" height="270"></canvas>
      </marimo-matplotlib>
    `;
    const canvas = document.querySelector("canvas")!;
    setRect(canvas, { height: 270, width: 550, x: 20, y: 30 });

    const baseTarget: LensTarget = {
      ...chartTarget,
      chart: {
        library: "matplotlib",
        parts: [
          { library: "matplotlib", kind: "axis", label: "x axis", detail: "Quarter" },
          { library: "matplotlib", kind: "axis", label: "y axis", detail: "Revenue" },
          { library: "matplotlib", kind: "legend", label: "legend" },
          { library: "matplotlib", kind: "mark", label: "patches", detail: "16" },
        ],
      },
    };

    const mark = resolveElementSelection(canvas, [baseTarget], { x: 220, y: 120 });
    const xAxis = resolveElementSelection(canvas, [baseTarget], { x: 220, y: 250 });
    const yAxis = resolveElementSelection(canvas, [baseTarget], { x: 52, y: 120 });
    const legend = resolveElementSelection(canvas, [baseTarget], { x: 488, y: 78 });

    expect(mark?.chartPart).toMatchObject({ kind: "mark", library: "matplotlib" });
    expect(xAxis?.chartPart).toMatchObject({ kind: "axis", label: "x axis" });
    expect(yAxis?.chartPart).toMatchObject({ kind: "axis", label: "y axis" });
    expect(legend?.chartPart).toMatchObject({ kind: "legend", library: "matplotlib" });
  });

  test("keeps Matplotlib chart parts when equivalent chart targets tie", () => {
    document.body.innerHTML = `
      <marimo-matplotlib>
        <canvas class="block cursor-crosshair" width="550" height="270"></canvas>
      </marimo-matplotlib>
    `;
    const canvas = document.querySelector("canvas")!;
    setRect(canvas, { height: 270, width: 550, x: 20, y: 30 });

    const chart = {
      library: "matplotlib",
      parts: [{ library: "matplotlib", kind: "mark", label: "patches", detail: "16" }],
    } satisfies NonNullable<LensTarget["chart"]>;
    const figureTarget: LensTarget = {
      ...chartTarget,
      id: "var:matplotlib_figure",
      variable: "matplotlib_figure",
      label: "matplotlib_figure",
      cellId: "ZHCJ",
      displayCellIds: ["ZHCJ"],
      chart,
    };
    const widgetTarget: LensTarget = {
      ...chartTarget,
      id: "var:matplotlib_widget",
      variable: "matplotlib_widget",
      label: "matplotlib_widget",
      cellId: "ZHCJ",
      displayCellIds: ["ZHCJ"],
      chart: {
        library: "matplotlib",
        parts: [{ library: "matplotlib", kind: "mark", label: "bars" }],
      },
    };
    const outputTarget: LensTarget = {
      ...chartTarget,
      id: "output:ZHCJ",
      label: "Chart output from cell ZHCJ",
      kind: "output",
      cellId: "ZHCJ",
      displayCellIds: ["ZHCJ"],
      chart,
    };

    const resolved = resolveElementSelection(canvas, [figureTarget, widgetTarget, outputTarget], {
      x: 220,
      y: 120,
    });

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.target.id).toBe("var:matplotlib_figure");
    expect(resolved?.chartPart).toMatchObject({
      kind: "mark",
      label: "patches",
      library: "matplotlib",
    });
  });

  test("infers generic SVG axes from aligned tick labels and tick marks", () => {
    document.body.innerHTML = `
      <svg>
        <g>
          <line></line>
          <line></line>
          <line></line>
          <text>Q1</text>
          <text>Q2</text>
          <text>Q3</text>
        </g>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    const [tick1, tick2, tick3] = [...document.querySelectorAll("line")];
    setRect(tick1, { height: 10, width: 1, x: 91, y: 208 });
    setRect(tick2, { height: 10, width: 1, x: 191, y: 208 });
    setRect(tick3, { height: 10, width: 1, x: 291, y: 208 });
    const [q1, q2, q3] = [...document.querySelectorAll("text")];
    setRect(q1, { height: 12, width: 20, x: 80, y: 224 });
    setRect(q2, { height: 12, width: 20, x: 180, y: 224 });
    setRect(q3, { height: 12, width: 20, x: 280, y: 224 });

    const resolved = resolveElementSelection(q2, [chartTarget]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      kind: "axis",
      label: "x axis",
      library: "visual",
    });
    expect(resolved?.context?.axis).toMatchObject({
      orientation: "x",
      tickCount: 3,
    });
  });

  test("infers generic SVG legends from paired swatches and labels", () => {
    document.body.innerHTML = `
      <svg>
        <g>
          <rect></rect>
          <text>North</text>
          <rect></rect>
          <text>South</text>
        </g>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    const [northSwatch, southSwatch] = [...document.querySelectorAll("rect")];
    setRect(northSwatch, { height: 10, width: 10, x: 330, y: 70 });
    setRect(southSwatch, { height: 10, width: 10, x: 330, y: 96 });
    const [north, south] = [...document.querySelectorAll("text")];
    setRect(north, { height: 12, width: 42, x: 348, y: 69 });
    setRect(south, { height: 12, width: 40, x: 348, y: 95 });

    const resolved = resolveElementSelection(south, [chartTarget]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      kind: "legend",
      label: "legend",
      library: "visual",
    });
    expect(resolved?.context?.legend).toMatchObject({
      labels: ["North", "South"],
      swatchCount: 2,
    });
  });

  test("hit-tests generic SVG marks and preserves data attributes", () => {
    document.body.innerHTML = `
      <svg>
        <rect data-category="Q2" data-value="42"></rect>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    const bar = document.querySelector("rect")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    setRect(bar, { height: 96, width: 36, x: 102, y: 92 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [svg];

    try {
      const resolved = resolveElementSelection(svg, [chartTarget], { x: 120, y: 140 });

      expect(resolved?.selection?.adapter).toBe("chart-part");
      expect(resolved?.chartPart).toMatchObject({
        datum: { category: "Q2", value: "42" },
        kind: "mark",
        label: "bar",
        library: "visual",
      });
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("does not let root SVG legend labels reclassify data marks", () => {
    document.body.innerHTML = `
      <svg aria-label="chart with legend">
        <rect data-category="Q2" data-value="42"></rect>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    const bar = document.querySelector("rect")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    setRect(bar, { height: 96, width: 36, x: 102, y: 92 });

    const resolved = resolveElementSelection(bar, [chartTarget], { x: 120, y: 140 });

    expect(resolved?.chartPart).toMatchObject({
      datum: { category: "Q2", value: "42" },
      kind: "mark",
      library: "visual",
    });
  });

  test("does not classify generic SVG background rects as bars", () => {
    document.body.innerHTML = `
      <svg>
        <rect class="background"></rect>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    const background = document.querySelector("rect")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    setRect(background, { height: 260, width: 420, x: 0, y: 0 });

    const resolved = resolveElementSelection(background, [chartTarget], { x: 120, y: 140 });

    expect(resolved?.chartPart?.kind).not.toBe("mark");
  });

  test("keeps large data-bearing generic SVG rects selectable", () => {
    document.body.innerHTML = `
      <svg>
        <rect data-category="All" data-value="100"></rect>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    const bar = document.querySelector("rect")!;
    setRect(svg, { height: 260, width: 420, x: 0, y: 0 });
    setRect(bar, { height: 230, width: 380, x: 20, y: 15 });

    const resolved = resolveElementSelection(bar, [chartTarget], { x: 120, y: 140 });

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      datum: { category: "All", value: "100" },
      kind: "mark",
      library: "visual",
    });
  });

  test("classifies open generic SVG paths as traces", () => {
    document.body.innerHTML = `
      <svg>
        <path d="M0 120L40 80L80 110"></path>
      </svg>
    `;
    const svg = document.querySelector("svg")!;
    const path = document.querySelector("path")!;
    setRect(svg, { height: 160, width: 160, x: 0, y: 0 });
    setRect(path, { height: 42, width: 84, x: 12, y: 76 });

    const resolved = resolveElementSelection(path, [chartTarget]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({
      kind: "trace",
      label: "path trace",
      library: "visual",
    });
  });

  test("keeps thin generic SVG axes selectable", () => {
    document.body.innerHTML = `
      <svg>
        <g class="axis"><line></line></g>
      </svg>
    `;
    const axis = document.querySelector(".axis")!;
    const line = document.querySelector("line")!;
    setRect(axis, { height: 1, width: 120, x: 20, y: 80 });
    setRect(line, { height: 1, width: 120, x: 20, y: 80 });

    const resolved = resolveElementSelection(line, [
      { ...chartTarget, chart: { library: "visual" } },
    ]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({ kind: "axis" });
    expect(resolved?.rect.height).toBeGreaterThan(2);
  });

  test("uses explicit generic SVG parent legend semantics for child marks", () => {
    document.body.innerHTML = `
      <svg>
        <g class="legend"><rect></rect><text>North</text></g>
      </svg>
    `;
    const legend = document.querySelector(".legend")!;
    const rect = document.querySelector("rect")!;
    const text = document.querySelector("text")!;
    setRect(legend, { height: 24, width: 90, x: 20, y: 30 });
    setRect(rect, { height: 12, width: 12, x: 20, y: 36 });
    setRect(text, { height: 14, width: 42, x: 38, y: 34 });

    const resolved = resolveElementSelection(rect, [
      { ...chartTarget, chart: { library: "visual" } },
    ]);

    expect(resolved?.selection?.adapter).toBe("chart-part");
    expect(resolved?.chartPart).toMatchObject({ kind: "legend" });
  });
});
