import { describe, expect, test } from "vitest";

import type { LensChartPart, LensTarget, SelectionModelUnit } from "@/types";

import { semanticSelectionFromHit } from "@/selection/selection-model";

const target: LensTarget = {
  id: "var:sales",
  variable: "sales",
  label: "sales",
  kind: "dataframe",
  columns: [
    { name: "region", dtype: "str" },
    { name: "revenue", dtype: "int64" },
  ],
  selectionModel: {
    defaultFallback: "column",
    units: [columnUnit("region", "str"), columnUnit("revenue", "int64")],
  },
};

function columnUnit(name: string, dtype: string): SelectionModelUnit {
  return {
    kind: "column",
    id: `col:${name}`,
    label: name,
    granularity: "group",
    supported: true,
    requires: [],
    selectors: [],
    fallbackFor: ["cell", "summary-stat", "dtype-label", "body-cell", "grid-cell"],
    match: { column: name },
    data: {
      column: name,
      columnDtype: dtype,
    },
  };
}

function element(tag = "div"): Element {
  return document.createElement(tag);
}

describe("semanticSelectionFromHit", () => {
  test("degrades granular cell evidence to a supported column unit", () => {
    const cell = element("td");
    const selection = semanticSelectionFromHit(target, {
      surface: "columnar-dom",
      desiredKind: "cell",
      element: cell,
      label: "revenue row 2",
      data: {
        column: "revenue",
        rowIndex: 1,
      },
      evidenceKind: "table-hit",
      hitKind: "body-cell",
    });

    expect(selection).toMatchObject({
      id: "col:revenue",
      kind: "column",
      granularity: "group",
      label: "revenue",
      data: {
        column: "revenue",
        semanticResolution: {
          reason: "fallback",
          unitKind: "column",
        },
      },
      evidence: [
        {
          data: {
            degradedFrom: "cell",
            desiredKind: "cell",
            resolvedKind: "column",
            resolution: "fallback",
          },
        },
      ],
    });
  });

  test("resolves bespoke semantic units through explicit match criteria", () => {
    const selection = semanticSelectionFromHit(
      {
        ...target,
        selectionModel: {
          defaultFallback: "column",
          units: [
            {
              id: "segment:enterprise",
              kind: "segment",
              label: "Enterprise segment",
              granularity: "group",
              match: { column: "segment", value: "enterprise" },
              data: { segment: "enterprise" },
            },
          ],
        },
      },
      {
        surface: "columnar-dom",
        desiredKind: "segment",
        element: element(),
        data: {
          column: "segment",
          value: "enterprise",
        },
      },
    );

    expect(selection).toMatchObject({
      id: "segment:enterprise",
      kind: "segment",
      granularity: "group",
      label: "Enterprise segment",
      data: {
        segment: "enterprise",
        value: "enterprise",
      },
    });
  });

  test("does not resolve units when required evidence is missing", () => {
    const selection = semanticSelectionFromHit(
      {
        ...target,
        selectionModel: {
          units: [
            {
              id: "segment:enterprise",
              kind: "segment",
              label: "Enterprise segment",
              granularity: "group",
              requires: ["value"],
              match: { column: "segment", value: "enterprise" },
            },
          ],
        },
      },
      {
        surface: "columnar-dom",
        desiredKind: "segment",
        element: element(),
        data: {
          column: "segment",
        },
      },
    );

    expect(selection).toMatchObject({
      kind: "segment",
      data: {
        semanticResolution: {
          reason: "synthetic",
        },
      },
    });
  });

  test("does not resolve units when explicit match criteria disagree", () => {
    const selection = semanticSelectionFromHit(
      {
        ...target,
        selectionModel: {
          units: [
            {
              id: "segment:enterprise",
              kind: "segment",
              label: "Enterprise segment",
              granularity: "group",
              match: { column: "segment", value: "enterprise" },
            },
          ],
        },
      },
      {
        surface: "columnar-dom",
        desiredKind: "segment",
        element: element(),
        data: {
          column: "segment",
          value: "self serve",
        },
      },
    );

    expect(selection).toMatchObject({
      kind: "segment",
      data: {
        semanticResolution: {
          reason: "synthetic",
        },
      },
    });
  });

  test("does not default a coarse target hit to an unrelated column", () => {
    const selection = semanticSelectionFromHit(
      {
        ...target,
        selectionModel: {
          defaultFallback: "column",
          units: [
            {
              kind: "column",
              id: "col:revenue",
              label: "revenue",
              match: { column: "revenue" },
              data: { column: "revenue" },
              fallbackFor: ["cell"],
            },
          ],
        },
      },
      {
        surface: "selector",
        desiredKind: "target",
        element: element(),
      },
    );

    expect(selection).toMatchObject({
      kind: "target",
      targetId: "var:sales",
      data: {
        semanticResolution: {
          reason: "synthetic",
        },
      },
    });
  });

  test("associates renderer evidence with Python-declared chart parts", () => {
    const pythonPart: LensChartPart = {
      library: "altair",
      kind: "axis",
      label: "x axis",
      field: "quarter",
    };
    const rendererPart: LensChartPart = {
      library: "vega",
      kind: "axis",
      label: "x axis",
      field: "quarter",
    };
    const selection = semanticSelectionFromHit(
      {
        id: "var:chart",
        variable: "chart",
        label: "chart",
        kind: "visualization",
        chart: {
          library: "altair",
          parts: [pythonPart],
        },
        selectionModel: {
          defaultFallback: "mark",
          units: [
            {
              kind: "axis",
              id: "chart:axis:0",
              label: "x axis",
              granularity: "group",
              supported: true,
              requires: [],
              selectors: [],
              fallbackFor: [],
              match: {
                chartKind: "axis",
                field: "quarter",
                label: "x axis",
                library: "altair",
              },
              data: {
                chartPart: pythonPart,
              },
            },
          ],
        },
      },
      {
        surface: "chart-part",
        desiredKind: "axis",
        element: element("g"),
        data: {
          chartPart: rendererPart,
        },
      },
    );

    expect(selection).toMatchObject({
      id: "chart:axis:0",
      kind: "axis",
      label: "x axis",
      data: {
        chartPart: pythonPart,
        semanticResolution: {
          reason: "exact",
          unitKind: "axis",
        },
      },
    });
  });
});
