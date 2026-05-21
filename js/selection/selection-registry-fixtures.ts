import type { LensTarget, SelectionModelUnit } from "@/types";

export function columnUnit(name: string, dtype?: string | null): SelectionModelUnit {
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
      columnDtype: dtype ?? null,
    },
  };
}

export function columnSelectionModel(columns: NonNullable<LensTarget["columns"]>) {
  return {
    defaultFallback: "column",
    units: columns.map((column) => columnUnit(column.name, column.dtype)),
  };
}

const dataframeColumns = [
  { name: "region", dtype: "str" },
  { name: "revenue", dtype: "int" },
];

const filteredSalesColumns = [
  { name: "region", dtype: "str" },
  { name: "channel", dtype: "str" },
  { name: "quarter", dtype: "str" },
  { name: "revenue", dtype: "int64" },
  { name: "margin", dtype: "float64" },
];

export const dataframeTarget: LensTarget = {
  id: "var:sales",
  variable: "sales",
  label: "sales",
  kind: "dataframe",
  columns: dataframeColumns,
  capabilities: { columnarDom: true, columnarGrid: true },
  selectionModel: columnSelectionModel(dataframeColumns),
};

export const filteredSalesTarget: LensTarget = {
  id: "var:filtered_sales",
  variable: "filtered_sales",
  label: "filtered_sales",
  kind: "dataframe",
  columns: filteredSalesColumns,
  capabilities: { columnarDom: true },
  selectionModel: columnSelectionModel(filteredSalesColumns),
};

export const chartTarget: LensTarget = {
  id: "var:chart",
  variable: "chart",
  label: "chart",
  kind: "visualization",
  capabilities: { chartPart: true, visualSurface: true },
};

export const mediaTarget: LensTarget = {
  id: "var:image",
  variable: "image",
  label: "image",
  kind: "media",
  capabilities: { media: true },
};

export const documentTarget: LensTarget = {
  id: "var:doc",
  variable: "doc",
  label: "doc",
  kind: "document",
  capabilities: { document: true },
};

export const interactiveTarget: LensTarget = {
  id: "var:limit",
  variable: "limit",
  label: "Limit",
  kind: "ui",
  component: "marimo-slider",
  capabilities: { interactive: true },
  selectionPolicy: { prefer: ["interactive", "selector"] },
};

export function setRect(element: Element, rect = { height: 24, width: 80, x: 10, y: 10 }) {
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
