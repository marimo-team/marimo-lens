import { describe, expect, test } from "vitest";

import type { LensTarget } from "@/types";

import {
  resolveElementSelection,
  resolvePointSelection,
  resolveTargetPreview,
  targetElementForSelection,
} from "@/selection/selection-registry";
import {
  chartTarget,
  dataframeTarget,
  filteredSalesTarget,
  setRect,
} from "@/selection/selection-registry-fixtures";

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

  test("keeps dataframe highlights on the selected column when a leading index column is rendered", () => {
    document.body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>int64</th>
            <th>region str</th>
            <th>channel str</th>
            <th>quarter str</th>
            <th>revenue int64</th>
            <th>margin float64</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0</td>
            <td>North</td>
            <td>Enterprise</td>
            <td>Q1</td>
            <td><span>142</span></td>
            <td>0.31</td>
          </tr>
          <tr>
            <td>2</td>
            <td>South</td>
            <td>Enterprise</td>
            <td>Q2</td>
            <td>117</td>
            <td>0.29</td>
          </tr>
        </tbody>
      </table>
    `;
    const columns = [...document.querySelectorAll("th")];
    const cells = [...document.querySelectorAll("td")];
    const tinyHit = document.querySelector("span")!;
    const width = 80;
    columns.forEach((column, index) => {
      setRect(column, { height: 24, width, x: 10 + index * width, y: 10 });
    });
    cells.forEach((cell, index) => {
      const row = Math.floor(index / 6);
      const column = index % 6;
      setRect(cell, { height: 22, width, x: 10 + column * width, y: 34 + row * 22 });
    });
    setRect(tinyHit, { height: 8, width: 20, x: 350, y: 41 });

    const resolved = resolveElementSelection(tinyHit, [filteredSalesTarget]);

    expect(resolved?.selection?.adapter).toBe("columnar-dom");
    expect(resolved?.column?.name).toBe("revenue");
    expect(resolved?.rect.left).toBe(329);
    expect(resolved?.rect.width).toBe(82);
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

  test("does not guess canvas-backed data editor columns without measured grid lines", () => {
    document.body.innerHTML = `
      <section id="output-editor">
        <marimo-data-editor
          data-field-types='[["region",["string","str"]],["quarter",["string","str"]],["revenue",["integer","int64"]],["margin",["number","float64"]]]'
        ></marimo-data-editor>
      </section>
    `;
    const host = document.querySelector("marimo-data-editor")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <canvas data-testid="data-grid-canvas"></canvas>
      <table role="grid">
        <thead>
          <tr>
            <th role="columnheader">region</th>
            <th role="columnheader">quarter</th>
            <th role="columnheader">revenue</th>
            <th role="columnheader">margin</th>
          </tr>
        </thead>
      </table>
    `;
    const canvas = root.querySelector("canvas")!;
    setRect(canvas, { height: 220, width: 800, x: 100, y: 80 });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    const originalRootElementsFromPoint = root.elementsFromPoint;
    document.elementsFromPoint = () => [host];
    root.elementsFromPoint = () => [canvas];

    try {
      const resolved = resolveElementSelection(
        host,
        [
          {
            ...dataframeTarget,
            id: "var:summary_editor",
            variable: "summary_editor",
            label: "summary_editor",
            component: "marimo-data-editor",
            columns: [
              { name: "region", dtype: "str" },
              { name: "quarter", dtype: "str" },
              { name: "revenue", dtype: "int64" },
              { name: "margin", dtype: "float64" },
            ],
            capabilities: { columnarGrid: true },
            displayCellIds: ["editor"],
          },
          {
            ...dataframeTarget,
            id: "output:editor",
            variable: undefined,
            label: "Table output from cell editor",
            kind: "output",
            component: "marimo-data-editor",
            columns: [
              { name: "region", dtype: "str" },
              { name: "quarter", dtype: "str" },
              { name: "revenue", dtype: "int64" },
              { name: "margin", dtype: "float64" },
            ],
            capabilities: { columnarGrid: true },
            cellId: "editor",
            displayCellIds: ["editor"],
          },
        ],
        { x: 520, y: 170 },
      );

      expect(resolved?.selection?.adapter).toBe("columnar-grid");
      expect(resolved?.target.id).toBe("var:summary_editor");
      expect(resolved?.selection?.kind).toBe("surface");
      expect(resolved?.column).toBeUndefined();
      expect(resolved?.semanticSelection.highlight.kind).toBe("element");
      expect(resolved?.rect.left).toBe(100);
      expect(resolved?.rect.width).toBe(800);
    } finally {
      document.elementsFromPoint = originalDocumentElementsFromPoint;
      root.elementsFromPoint = originalRootElementsFromPoint;
    }
  });

  test("uses measured Glide grid lines for canvas-backed data editor columns", () => {
    document.body.innerHTML = `
      <section id="output-editor">
        <marimo-data-editor
          data-field-types='[["region",["string","str"]],["quarter",["string","str"]],["revenue",["integer","int64"]],["margin",["number","float64"]]]'
        ></marimo-data-editor>
      </section>
    `;
    const host = document.querySelector("marimo-data-editor")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <canvas data-testid="data-grid-canvas" width="600" height="206"></canvas>
      <table role="grid">
        <thead>
          <tr>
            <th role="columnheader" aria-colindex="1">region</th>
            <th role="columnheader" aria-colindex="2">quarter</th>
            <th role="columnheader" aria-colindex="3">revenue</th>
            <th role="columnheader" aria-colindex="4">margin</th>
          </tr>
        </thead>
      </table>
    `;
    const canvas = root.querySelector("canvas")!;
    setRect(canvas, { height: 206, width: 600, x: 100, y: 80 });
    const verticalLines = new Set([32, 115, 204, 297, 462]);
    Object.defineProperty(canvas, "getContext", {
      configurable: true,
      value: () => ({
        getImageData: (x: number) => ({
          data: verticalLines.has(x)
            ? new Uint8ClampedArray([232, 233, 235, 255])
            : new Uint8ClampedArray([255, 255, 255, 255]),
        }),
      }),
    });
    const originalDocumentElementsFromPoint = document.elementsFromPoint;
    const originalRootElementsFromPoint = root.elementsFromPoint;
    document.elementsFromPoint = () => [host];
    root.elementsFromPoint = () => [canvas];

    try {
      const resolved = resolveElementSelection(
        host,
        [
          {
            ...dataframeTarget,
            id: "var:summary_editor",
            variable: "summary_editor",
            label: "summary_editor",
            component: "marimo-data-editor",
            columns: [
              { name: "region", dtype: "str" },
              { name: "quarter", dtype: "str" },
              { name: "revenue", dtype: "int64" },
              { name: "margin", dtype: "float64" },
            ],
            capabilities: { columnarGrid: true },
          },
        ],
        { x: 350, y: 130 },
      );

      expect(resolved?.selection?.adapter).toBe("columnar-grid");
      expect(resolved?.column?.name).toBe("revenue");
      expect(resolved?.rect.left).toBe(303);
      expect(resolved?.rect.width).toBe(95);
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

  test("scopes marimo cells by raw data-cell-id from cell-* host ids", () => {
    document.body.innerHTML = `
      <section id="cell-cell-data" data-cell-id="cell-data" data-cell-name="view">
        <div id="output-cell-data">
          <table>
            <tbody><tr><td data-column="revenue">142</td></tr></tbody>
          </table>
        </div>
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
        <div id="output-view">
          <table>
            <tbody><tr><td data-column="revenue">142</td></tr></tbody>
          </table>
        </div>
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

  test("ignores marimo chrome controls inside a displayed cell", () => {
    document.body.innerHTML = `
      <section id="cell-vblA" class="marimo-cell" data-cell-id="vblA" data-cell-name="_">
        <div id="output-vblA" class="output-area">
          <div class="output block">
            <svg aria-label="Barley yield chart"></svg>
          </div>
          <button class="hover-action" aria-label="Expand output">Expand output</button>
        </div>
      </section>
    `;
    const output = document.getElementById("output-vblA")!;
    const chart = document.querySelector("svg")!;
    const chrome = document.querySelector("button")!;
    setRect(output, { height: 240, width: 560, x: 20, y: 30 });
    setRect(chart, { height: 180, width: 360, x: 40, y: 56 });
    setRect(chrome, { height: 28, width: 120, x: 220, y: 40 });
    const target: LensTarget = {
      ...chartTarget,
      id: "output:vblA",
      variable: undefined,
      label: "Chart output from cell vblA",
      kind: "output",
      cellId: "vblA",
      displayCellIds: ["vblA"],
      selectors: ['[id="output-vblA"]'],
      selectionPolicy: { prefer: ["visual-surface", "display-cell", "selector"] },
    };
    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = () => [chrome, output, chart];

    try {
      expect(resolveElementSelection(chrome, [target], { x: 240, y: 48 })).toBeNull();
      expect(resolvePointSelection({ x: 240, y: 48 }, [target])).toBeNull();
    } finally {
      document.elementsFromPoint = originalElementsFromPoint;
    }
  });

  test("still selects real output content inside a displayed cell", () => {
    document.body.innerHTML = `
      <section id="cell-vblA" class="marimo-cell" data-cell-id="vblA" data-cell-name="_">
        <div id="output-vblA" class="output-area">
          <div class="output block">
            <svg aria-label="Barley yield chart"></svg>
          </div>
        </div>
      </section>
    `;
    const output = document.getElementById("output-vblA")!;
    const chart = document.querySelector("svg")!;
    setRect(output, { height: 240, width: 560, x: 20, y: 30 });
    setRect(chart, { height: 180, width: 360, x: 40, y: 56 });
    const target: LensTarget = {
      ...chartTarget,
      id: "output:vblA",
      variable: undefined,
      label: "Chart output from cell vblA",
      kind: "output",
      cellId: "vblA",
      displayCellIds: ["vblA"],
      selectors: ['[id="output-vblA"]'],
      selectionPolicy: { prefer: ["visual-surface", "display-cell", "selector"] },
    };

    const resolved = resolveElementSelection(chart, [target], { x: 120, y: 120 });

    expect(resolved?.target.id).toBe("output:vblA");
    expect(resolved?.selection?.adapter).toBe("visual-surface");
    expect(resolved?.displayCellId).toBe("vblA");
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

  test("falls back to the rendered cell when the first target preview is not usable", () => {
    document.body.innerHTML = `
      <div id="empty-selector"></div>
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
      selectors: ["#empty-selector"],
    };

    expect(targetElementForSelection(target, [target])).toBe(
      document.getElementById("empty-selector"),
    );
    expect(resolveTargetPreview(target, [target])?.element).toBe(output);
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
});
