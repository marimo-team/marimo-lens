import type { PairFeedback, PairFeedbackAnnotation } from "@/types";

export function pairFeedback(overrides: Partial<PairFeedback> = {}): PairFeedback {
  const annotation = feedbackAnnotation();
  return {
    protocol: "marimo-pair.feedback",
    version: 1,
    generatedAt: "2026-05-21T00:00:00Z",
    source: { package: "marimo-lens", title: "demo" },
    notebook: {
      available: true,
      filename: "demo.py",
      cells: [],
      definitions: {},
      edges: [],
      controls: {
        summary: {
          uiElementCount: 2,
          widgetCount: 1,
          traitletsObjectCount: 1,
          errorCount: 0,
        },
      },
    },
    targets: [
      {
        id: "var:sales",
        label: "sales",
        variable: "sales",
        kind: "dataframe",
        cellId: "cell-data",
      },
      {
        id: "var:unrelated",
        label: "unrelated",
        kind: "object",
      },
    ],
    targetIndex: {
      "var:sales": { id: "var:sales", cellId: "cell-data" },
    },
    displayProvenance: [{ annotationId: "a1", targetId: "var:sales" }],
    contextPolicy: { redaction: "none" },
    summary: {
      annotationCount: 1,
      targetCells: ["cell-data", "cell-view"],
    },
    groups: [{ cellId: "cell-data", annotationIds: ["a1"] }],
    instructions: ["inspect first"],
    markdown: "## feedback",
    annotations: [annotation],
    ...overrides,
  };
}

export function feedbackAnnotation(
  overrides: Partial<PairFeedbackAnnotation> = {},
): PairFeedbackAnnotation {
  return {
    id: "a1",
    index: 1,
    createdAt: "2026-05-21T00:00:00Z",
    request: "Sort by revenue descending.",
    target: {
      id: "var:sales",
      label: "sales",
      variable: "sales",
      kind: "dataframe",
      status: "current",
      column: "revenue",
      columnDtype: "int64",
      chartPart: null,
      semanticSelection: null,
      pythonType: "DataFrame",
      summary: "3 rows x 2 columns",
      defs: ["sales"],
      refs: ["pd"],
      output: {},
      outputType: "dataframe",
      codePreview: "sales = pd.DataFrame(...)",
    },
    targetSnapshot: {
      id: "var:sales",
      label: "sales",
      variable: "sales",
      kind: "dataframe",
    },
    cells: {
      definition: "cell-data",
      display: "cell-view",
      output: "cell-view",
      editFocus: "cell-data",
      related: ["cell-data", "cell-view"],
      downstream: ["cell-view"],
      previews: [
        {
          id: "cell-data",
          defs: ["sales"],
          refs: ["pd"],
          outputRefs: ["sales"],
          hasOutputExpression: true,
          status: "idle",
          stale: false,
          disabled: false,
          codePreview: "sales = pd.DataFrame({'revenue': [1, 2, 3]})",
        },
      ],
    },
    evidence: {
      element: "td",
      elementPath: "table > tbody > tr:first-child > td:nth-child(2)",
      semanticSelection: null,
      documentPoint: { x: 10, y: 20 },
      boundingBox: { x: 0, y: 0, width: 100, height: 24 },
    },
    marimoPair: {
      editBoundary: {
        mode: "marimo-code-mode",
        cellIds: ["cell-data"],
        smallestSafeSurface: "full-cell-body",
      },
      readBeforeEdit: ["cell-data", "cell-view"],
      runAfterEdit: ["cell-data", "cell-view"],
      reportingProtocol: {},
      editGuardrail: "Use ctx.edit_cell.",
    },
    ...overrides,
  };
}
