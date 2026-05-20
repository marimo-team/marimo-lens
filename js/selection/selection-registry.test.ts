import { describe, expect, test } from "vitest";
import {
  resolveElementSelection,
  resolvePointSelection,
  targetElementForSelection,
} from "@/selection/selection-registry";
import type { LensTarget } from "@/types";

const dataframeTarget: LensTarget = {
  id: "var:sales",
  variable: "sales",
  label: "sales",
  kind: "dataframe",
  columns: [
    { name: "region", dtype: "str" },
    { name: "revenue", dtype: "int" },
  ],
  capabilities: { columnarDom: true, columnarGrid: true },
};

const chartTarget: LensTarget = {
  id: "var:chart",
  variable: "chart",
  label: "chart",
  kind: "visualization",
  capabilities: { chartPart: true, visualSurface: true },
};

const mediaTarget: LensTarget = {
  id: "var:image",
  variable: "image",
  label: "image",
  kind: "media",
  capabilities: { media: true },
};

const documentTarget: LensTarget = {
  id: "var:doc",
  variable: "doc",
  label: "doc",
  kind: "document",
  capabilities: { document: true },
};

const interactiveTarget: LensTarget = {
  id: "var:limit",
  variable: "limit",
  label: "Limit",
  kind: "ui",
  component: "marimo-slider",
  capabilities: { interactive: true },
  selectionPolicy: { prefer: ["interactive", "selector"] },
};

function setRect(element: Element, rect = { height: 24, width: 80, x: 10, y: 10 }) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        ...rect,
        bottom: rect.y + rect.height,
        left: rect.x,
        right: rect.x + rect.width,
        top: rect.y,
        toJSON: () => rect,
      }) as DOMRect,
  });
}

describe("resolveElementSelection", () => {
  test("prefers a target selection policy over plugin priority", () => {
    document.body.innerHTML = `
      <div data-orders>
        <table>
          <thead><tr><th data-column="revenue">Revenue</th></tr></thead>
          <tbody><tr><td data-column="revenue">142</td></tr></tbody>
        </table>
      </div>
    `;
    const cell = document.querySelector("td")!;
    setRect(cell);
    const target: LensTarget = {
      ...dataframeTarget,
      selectors: ["[data-orders]"],
      selectionPolicy: { prefer: ["selector"] },
    };

    const resolved = resolveElementSelection(cell, [target]);

    expect(resolved?.target.id).toBe("var:sales");
    expect(resolved?.selection?.adapter).toBe("selector");
  });

  test("resolves columns inside nested open shadow roots", () => {
    document.body.innerHTML = "<marimo-lens-shadow-grid></marimo-lens-shadow-grid>";
    const host = document.querySelector("marimo-lens-shadow-grid")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <section role="grid">
        <div role="columnheader" data-column="revenue">Revenue</div>
        <marimo-lens-shadow-cell data-column="revenue"></marimo-lens-shadow-cell>
      </section>
    `;
    const leaf = root.querySelector("marimo-lens-shadow-cell")!;
    const leafRoot = leaf.attachShadow({ mode: "open" });
    leafRoot.innerHTML = `<button data-column="revenue">142</button>`;
    const button = leafRoot.querySelector("button")!;
    setRect(button);

    const resolved = resolveElementSelection(button, [dataframeTarget]);

    expect(resolved?.selection?.adapter).toBe("columnar-grid");
    expect(resolved?.column?.name).toBe("revenue");
  });

  test("degrades body-cell hits to column semantic selections with full-column highlights", () => {
    document.body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th data-column="region">Region</th>
            <th data-column="revenue">Revenue</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-column="region">North</td>
            <td data-column="revenue"><span>142</span></td>
          </tr>
          <tr>
            <td data-column="region">South</td>
            <td data-column="revenue">87</td>
          </tr>
        </tbody>
      </table>
    `;
    const [regionHeader, revenueHeader] = [...document.querySelectorAll("th")];
    const [regionOne, revenueOne, regionTwo, revenueTwo] = [...document.querySelectorAll("td")];
    const tinyHit = document.querySelector("span")!;
    setRect(regionHeader, { height: 24, width: 80, x: 10, y: 10 });
    setRect(revenueHeader, { height: 24, width: 90, x: 90, y: 10 });
    setRect(regionOne, { height: 22, width: 80, x: 10, y: 34 });
    setRect(revenueOne, { height: 22, width: 90, x: 90, y: 34 });
    setRect(regionTwo, { height: 22, width: 80, x: 10, y: 56 });
    setRect(revenueTwo, { height: 22, width: 90, x: 90, y: 56 });
    setRect(tinyHit, { height: 8, width: 20, x: 104, y: 41 });

    const resolved = resolveElementSelection(tinyHit, [dataframeTarget]);

    expect(resolved?.semanticSelection).toMatchObject({
      kind: "column",
      granularity: "group",
      label: "revenue",
      data: {
        column: "revenue",
        hitKind: "body-cell",
        surface: "columnar-dom",
      },
      evidence: [
        {
          hitKind: "body-cell",
          column: "revenue",
          data: {
            degradedFrom: "cell",
          },
        },
      ],
    });
    expect(resolved?.selection?.kind).toBe("column");
    expect(resolved?.column?.name).toBe("revenue");
    expect(resolved?.rect.left).toBe(89);
    expect(resolved?.rect.top).toBe(9);
    expect(resolved?.rect.width).toBe(92);
    expect(resolved?.rect.height).toBe(70);
  });

  test("uses point-based shadow traversal when pointer events surface a host", () => {
    document.body.innerHTML = "<marimo-table></marimo-table>";
    const host = document.querySelector("marimo-table")!;
    setRect(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <div role="grid">
        <div role="columnheader" data-column="revenue">Revenue</div>
        <button data-column="revenue">142</button>
      </div>
    `;
    const button = root.querySelector("button")!;
    setRect(button);
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    const originalRootElementsFromPoint = root.elementsFromPoint;
    document.elementsFromPoint = () => [host];
    root.elementsFromPoint = () => [button];

    try {
      const resolved = resolveElementSelection(host, [dataframeTarget], { x: 12, y: 12 });

      expect(resolved?.selection?.adapter).toBe("columnar-grid");
      expect(resolved?.column?.name).toBe("revenue");
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
      root.elementsFromPoint = originalRootElementsFromPoint;
    }
  });

  test("resolves the pointed element when the event target is not useful", () => {
    document.body.innerHTML = "<marimo-table></marimo-table>";
    const host = document.querySelector("marimo-table")!;
    setRect(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <div role="grid">
        <div role="columnheader" data-column="revenue">Revenue</div>
        <button data-column="revenue">142</button>
      </div>
    `;
    const button = root.querySelector("button")!;
    setRect(button);
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    const originalRootElementsFromPoint = root.elementsFromPoint;
    document.elementsFromPoint = () => [host];
    root.elementsFromPoint = () => [button];

    try {
      const resolved = resolvePointSelection({ x: 12, y: 12 }, [dataframeTarget]);

      expect(resolved?.selection?.adapter).toBe("columnar-grid");
      expect(resolved?.column?.name).toBe("revenue");
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
      root.elementsFromPoint = originalRootElementsFromPoint;
    }
  });

  test("does not guess between equally plausible columnar targets", () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th data-column="revenue">Revenue</th></tr></thead>
        <tbody><tr><td data-column="revenue">142</td></tr></tbody>
      </table>
    `;
    const cell = document.querySelector("td")!;
    setRect(cell);
    const otherTarget: LensTarget = {
      ...dataframeTarget,
      id: "var:orders",
      variable: "orders",
      label: "orders",
    };

    const resolved = resolveElementSelection(cell, [dataframeTarget, otherTarget]);

    expect(resolved).toBeNull();
  });

  test("resolves Vega and Altair axis groups as chart units", () => {
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
    expect(resolved?.chartPart).toMatchObject({
      kind: "axis",
      library: "vega",
    });
    expect(resolved?.displayCellId).toBe("chart-cell");
  });

  test("prefers variable chart semantics over output targets for chart units", () => {
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
    expect(resolved?.target.id).toBe("var:chart");
  });

  test("scopes marimo cells by raw data-cell-id from cell-* host ids", () => {
    document.body.innerHTML = `
      <section id="cell-cell-data" data-cell-id="cell-data" data-cell-name="view">
          <table>
            <tbody><tr><td data-column="revenue">142</td></tr></tbody>
          </table>
      </section>
    `;
    const cell = document.querySelector("td")!;
    setRect(cell);

    const resolved = resolveElementSelection(cell, [
      {
        ...dataframeTarget,
        displayCellIds: ["cell-data"],
      },
      {
        ...dataframeTarget,
        id: "var:orders",
        variable: "orders",
        label: "orders",
        displayCellIds: ["cell-view"],
      },
    ]);

    expect(resolved?.target.id).toBe("var:sales");
    expect(resolved?.displayCellId).toBe("cell-data");
  });

  test("normalizes cell-* ids without leaking the DOM prefix", () => {
    document.body.innerHTML = `
      <section id="cell-view" data-cell-name="view">
        <table>
          <tbody><tr><td data-column="revenue">142</td></tr></tbody>
        </table>
      </section>
    `;
    const cell = document.querySelector("td")!;
    setRect(cell);

    const resolved = resolveElementSelection(cell, [
      {
        ...dataframeTarget,
        displayCellIds: ["view"],
      },
    ]);

    expect(resolved?.displayCellId).toBe("view");
  });

  test("selects a first-class output target for rendered cell regions", () => {
    document.body.innerHTML = `
      <section id="output-SFPL">
        <div class="marimo-output">movies.shape</div>
      </section>
    `;
    const outputCell = document.getElementById("output-SFPL")!;
    const outputRegion = document.querySelector(".marimo-output")!;
    setRect(outputCell, { height: 180, width: 520, x: 10, y: 20 });
    setRect(outputRegion, { height: 48, width: 220, x: 20, y: 30 });
    const outputTarget: LensTarget = {
      id: "output:SFPL",
      label: "Output from cell SFPL",
      kind: "output",
      cellId: "SFPL",
      displayCellIds: ["SFPL"],
      refs: ["movies"],
      selectionPolicy: { prefer: ["display-cell", "selector"] },
      selectors: ['[id="output-SFPL"]'],
    };

    const resolved = resolveElementSelection(outputRegion, [
      {
        ...dataframeTarget,
        displayCellIds: ["SFPL"],
      },
      outputTarget,
    ]);

    expect(resolved?.target.id).toBe("output:SFPL");
    expect(resolved?.target.kind).toBe("output");
    expect(resolved?.semanticSelection.kind).toBe("output");
    expect(resolved?.displayCellId).toBe("SFPL");
    expect(resolved?.rect.width).toBe(520);
    expect(resolved?.rect.height).toBe(180);
    expect(resolved?.context).toMatchObject({
      displayCellId: "SFPL",
      surface: "marimo-output-cell",
    });
  });

  test("previews same-cell outputs when displayCellIds are absent", () => {
    document.body.innerHTML = `
      <section id="output-cell-data">
        <table>
          <tbody><tr><td>142</td></tr></tbody>
        </table>
      </section>
    `;
    const output = document.getElementById("output-cell-data")!;
    setRect(output, { height: 80, width: 420, x: 20, y: 30 });

    const target: LensTarget = {
      ...dataframeTarget,
      cellId: "cell-data",
      displayCellIds: [],
    };

    expect(targetElementForSelection(target, [target])).toBe(output);
  });

  test("skips table-internal data-cell-id values before notebook cells", () => {
    document.body.innerHTML = `
      <section id="output-cell-view">
        <table>
          <tbody><tr><td data-cell-id="0_revenue" data-column="revenue">142</td></tr></tbody>
        </table>
      </section>
    `;
    const cell = document.querySelector("td")!;
    setRect(cell);

    const resolved = resolveElementSelection(cell, [
      {
        ...dataframeTarget,
        displayCellIds: ["cell-view"],
      },
      {
        ...dataframeTarget,
        id: "var:orders",
        variable: "orders",
        label: "orders",
        displayCellIds: ["other-cell"],
      },
    ]);

    expect(resolved?.target.id).toBe("var:sales");
    expect(resolved?.displayCellId).toBe("cell-view");
    expect(resolved?.column?.name).toBe("revenue");
  });

  test("uses marimo component hosts to break same-column target ties", () => {
    document.body.innerHTML = `
      <section id="output-cell-view">
        <marimo-table>
          <table>
            <thead><tr><th data-column="revenue">Revenue</th></tr></thead>
            <tbody><tr><td data-cell-id="0_revenue" data-column="revenue">142</td></tr></tbody>
          </table>
        </marimo-table>
      </section>
    `;
    const cell = document.querySelector("td")!;
    setRect(cell);

    const resolved = resolveElementSelection(cell, [
      {
        ...dataframeTarget,
        displayCellIds: ["cell-view"],
      },
      {
        ...dataframeTarget,
        component: "marimo-table",
        id: "var:sales_table",
        kind: "table",
        variable: "sales_table",
        label: "sales_table",
        displayCellIds: ["cell-view"],
      },
    ]);

    expect(resolved?.target.id).toBe("var:sales_table");
    expect(resolved?.column?.name).toBe("revenue");
  });

  test("resolves coarse media targets without adding per-mime target kinds", () => {
    document.body.innerHTML = `<figure><img alt="chart snapshot" src="/demo.png" /></figure>`;
    const image = document.querySelector("img")!;
    setRect(image, { height: 120, width: 180, x: 20, y: 30 });

    const resolved = resolveElementSelection(image, [mediaTarget]);

    expect(resolved?.selection?.adapter).toBe("media");
    expect(resolved?.selection?.kind).toBe("media-surface");
    expect(resolved?.target.kind).toBe("media");
  });

  test("resolves document surfaces separately from media", () => {
    document.body.innerHTML = `<object data="/report.pdf" type="application/pdf"></object>`;
    const object = document.querySelector("object")!;
    setRect(object, { height: 320, width: 240, x: 20, y: 30 });

    const resolved = resolveElementSelection(object, [documentTarget]);

    expect(resolved?.selection?.adapter).toBe("document");
    expect(resolved?.selection?.kind).toBe("document-surface");
    expect(resolved?.target.kind).toBe("document");
  });

  test("resolves non-columnar interactive controls through a real surface", () => {
    document.body.innerHTML = `
      <section id="output-controls">
        <marimo-slider>
          <label>Limit</label>
          <input type="range" aria-label="Limit" />
        </marimo-slider>
      </section>
    `;
    const input = document.querySelector("input")!;
    setRect(input, { height: 24, width: 160, x: 20, y: 30 });

    const resolved = resolveElementSelection(input, [interactiveTarget]);

    expect(resolved?.selection?.adapter).toBe("interactive");
    expect(resolved?.target.id).toBe("var:limit");
    expect(resolved?.element.tagName.toLowerCase()).toBe("input");
    expect(resolved?.context).toMatchObject({
      component: "marimo-slider",
      surface: "interactive",
    });
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

      expect(resolved?.selection?.adapter).toBe("chart-unit");
      expect(resolved?.chartPart).toMatchObject({
        kind: "mark",
        label: "bar",
        library: "altair",
      });
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
    }
  });

  test("resolves Plotly legends as chart units", () => {
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
    expect(resolved?.chartPart).toMatchObject({
      kind: "legend",
      library: "plotly",
    });
  });

  test("resolves Matplotlib SVG marks as chart units", () => {
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
    expect(resolved?.chartPart).toMatchObject({
      kind: "mark",
      library: "matplotlib",
      label: "line",
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
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

      expect(resolved?.selection?.adapter).toBe("chart-unit");
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

    expect(resolved?.selection?.adapter).toBe("chart-unit");
    expect(resolved?.chartPart).toMatchObject({
      kind: "trace",
      label: "path trace",
      library: "visual",
    });
  });
});
