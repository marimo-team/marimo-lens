export type LensColumn = {
  name: string;
  dtype?: string | null;
};

export type LensTargetKind =
  | "anywidget"
  | "data"
  | "dataframe"
  | "diagnostic"
  | "document"
  | "layout"
  | "media"
  | "object"
  | "output"
  | "table"
  | "ui"
  | "visualization";

export type RuntimeControlKind = "anywidget" | "traitlets" | "ui";

export type AgentActivityKind =
  | "agent-started"
  | "agent-finished"
  | "cell-mark"
  | "annotation-status";

export type AgentCellMarkKind = "read" | "claimed" | "edited" | "ran" | "failed" | "needs-review";

export type SelectionSurface =
  | "chart-unit"
  | "columnar-dom"
  | "columnar-grid"
  | "document"
  | "display-cell"
  | "interactive"
  | "media"
  | "marked"
  | "selector"
  | "visual-surface";

export type SelectionGranularity = "target" | "surface" | "group" | "item" | "datum";

export type SelectionModelUnit = {
  kind: string;
  id?: string;
  label?: string;
  parentId?: string;
  supported?: boolean;
  requires?: string[];
  selectors?: string[];
  fallbackFor?: string[];
  data?: Record<string, unknown>;
};

export type SelectionModel = {
  units: SelectionModelUnit[];
  defaultFallback?: string;
};

export type LensChartPartKind =
  | "annotation"
  | "axis"
  | "legend"
  | "mark"
  | "plot-area"
  | "title"
  | "trace";

export type LensChartLibrary =
  | "altair"
  | "matplotlib"
  | "plotly"
  | "vega"
  | "visual"
  | (string & {});

export type LensChartPart = {
  library: LensChartLibrary;
  kind: LensChartPartKind;
  label: string;
  id?: string;
  detail?: string;
  channel?: string;
  field?: string;
  orientation?: string;
  selector?: string;
  datum?: Record<string, unknown>;
  context?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type LensChartMetadata = {
  library: LensChartLibrary;
  parts?: LensChartPart[];
  renderer?: "canvas" | "html" | "svg" | "unknown" | (string & {});
  encoding?: Record<string, unknown>;
  mark?: string | Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type LensTarget = {
  id: string;
  variable?: string;
  label: string;
  kind: LensTargetKind;
  cellId?: string | null;
  displayCellIds?: string[];
  relatedCellIds?: string[];
  defs?: string[];
  refs?: string[];
  shape?: { rows?: number; columns?: number } | null;
  columns?: LensColumn[];
  chart?: LensChartMetadata | null;
  component?: string;
  entity?: {
    inspector: string;
    family: string;
  };
  capabilities?: {
    columnarDom?: boolean;
    columnarGrid?: boolean;
    data?: boolean;
    diagnostic?: boolean;
    document?: boolean;
    interactive?: boolean;
    chartPart?: boolean;
    media?: boolean;
    visualSurface?: boolean;
  };
  selectionPolicy?: {
    prefer?: SelectionSurface[];
    context?: Record<string, unknown>;
  };
  selectionModel?: SelectionModel;
  summary?: string;
  selectors?: string[];
  pythonType?: string;
  output?: {
    kind?: string;
    type?: string;
    cellId?: string;
    codePreview?: string;
  };
  outputRefs?: string[];
  outputType?: string;
  codePreview?: string;
};

export type NotebookGraph = {
  available?: boolean;
  collectedAt?: string;
  currentCellId?: string;
  filename?: string;
  cells?: Array<{
    id: string;
    defs: string[];
    refs: string[];
    outputRefs?: string[];
    outputType?: string;
    hasOutputExpression?: boolean;
    language?: string;
    status?: string;
    stale?: boolean;
    disabled?: boolean;
    codePreview?: string;
  }>;
  definitions?: Record<string, string[]>;
  edges?: Array<{ from: string; to: string }>;
  globals?: Array<{
    name: string;
    kind: string;
    pythonType: string;
    cellIds: string[];
    shape?: { rows?: number; columns?: number } | null;
    columns?: LensColumn[];
    chart?: LensChartMetadata | null;
    summary?: string;
  }>;
  controls?: {
    summary?: {
      uiElementCount?: number;
      widgetCount?: number;
      traitletsObjectCount?: number;
      errorCount?: number;
    };
    uiElements?: RuntimeControl[];
    widgets?: RuntimeControl[];
    traitletsObjects?: RuntimeControl[];
    errors?: Array<{ name: string; pythonType: string; error: string }>;
  };
  runtime?: {
    sessionMode?: string;
    lazy?: boolean;
    queryParams?: Record<string, unknown>;
    argv?: unknown[];
  };
  reason?: string;
};

export type RuntimeControl = {
  name: string;
  kind: RuntimeControlKind;
  component?: string;
  pythonType: string;
  cellIds?: string[];
  elementId?: string;
  label?: string;
  value?: unknown;
  initialValue?: unknown;
  frontendValue?: unknown;
  args?: Record<string, unknown>;
  traits?: string[];
  state?: Record<string, unknown>;
  summary?: string;
};

export type AgentActivity = {
  id: string;
  kind: AgentActivityKind;
  actor?: {
    type: "agent";
    label: string;
    runId: string;
  };
  createdAt: string;
  cellIds?: string[];
  annotationIds?: string[];
  status?:
    | AgentCellMarkKind
    | "started"
    | "completed"
    | "blocked"
    | "in_progress"
    | "addressed"
    | "needs_human";
  note?: string;
  details?: Record<string, unknown>;
  provenance?: {
    origin: "agent";
    source: string;
    protocol: string;
    version: number;
  };
};

export type AgentCommand = {
  id: string;
  kind: "focus-cell";
  createdAt: string;
  cellId: string;
  reason?: string;
};

export type PairResult = {
  protocol?: "marimo-pair.result";
  version?: number;
  source?: {
    package?: string;
    agent?: string;
  };
  summary?: {
    cellsRead?: number;
    cellsEdited?: number;
    cellsRun?: number;
    annotationsAddressed?: number;
  };
  activity?: AgentActivity[];
  openQuestions?: unknown[];
  warnings?: unknown[];
};

export type LensAnnotation = {
  id: string;
  targetId: string;
  targetLabel?: string;
  variable?: string;
  kind?: string;
  column?: string;
  columnDtype?: string | null;
  chartPart?: LensChartPart | null;
  cellId?: string | null;
  displayCellId?: string | null;
  comment: string;
  intent: "fix" | "question" | "explain" | "approve";
  severity: "blocking" | "important" | "suggestion";
  element: string;
  elementPath: string;
  documentX: number;
  documentY: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  anchor?: LensAnnotationAnchor;
  semanticSelection?: SerializedSemanticSelection;
  createdAt: string;
  context?: Record<string, unknown>;
};

export type LensAnnotationAnchor = {
  version: 1;
  fixed: boolean;
  rootCellId?: string | null;
  elementPath?: string;
  selectorPath?: LensAnchorPathStep[];
  elementOffset?: { x: number; y: number };
  cellOffset?: { x: number; y: number };
  viewportPoint?: { x: number; y: number };
  documentPoint: { x: number; y: number };
};

export type LensAnchorPathStep = {
  selector: string;
  shadow?: boolean;
};

export type SelectionEvidence = {
  kind: string;
  hitKind?: string;
  selector?: string;
  elementName?: string;
  column?: string;
  rowIndex?: number;
  data?: Record<string, unknown>;
  element?: Element;
};

export type SelectionHighlight =
  | {
      kind: "element";
      element: Element;
      padding?: number;
      strategy?: string;
    }
  | {
      kind: "elements";
      elements: Element[];
      fallbackElement?: Element;
      padding?: number;
      strategy?: string;
    }
  | {
      kind: "rect";
      rect: DOMRect;
      padding?: number;
      strategy?: string;
    };

export type SelectionAnchorSpec = {
  element?: Element;
  rootCellId?: string | null;
  selector?: string;
  point?: ViewportPoint;
  data?: Record<string, unknown>;
};

export type SemanticSelection = {
  id: string;
  targetId: string;
  kind: string;
  granularity: SelectionGranularity;
  label: string;
  parentId?: string;
  data?: Record<string, unknown>;
  evidence: SelectionEvidence[];
  highlight: SelectionHighlight;
  anchor: SelectionAnchorSpec;
};

export type SerializedSemanticSelection = {
  id: string;
  targetId: string;
  kind: string;
  granularity: SelectionGranularity;
  label: string;
  parentId?: string;
  data?: Record<string, unknown>;
  evidence: Array<Omit<SelectionEvidence, "element">>;
  highlight: {
    kind: SelectionHighlight["kind"];
    strategy?: string;
    padding?: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
  };
  anchor: Omit<SelectionAnchorSpec, "element">;
};

export type ResolvedHover = {
  element: Element;
  rect: DOMRect;
  target: LensTarget;
  semanticSelection: SemanticSelection;
  column?: LensColumn;
  chartPart?: LensChartPart | null;
  displayCellId?: string | null;
  elementName: string;
  elementPath: string;
  selection?: {
    adapter: SelectionSurface;
    kind: string;
    score?: number;
  };
  context?: Record<string, unknown>;
};

export type PopupState = {
  hover: ResolvedHover;
  x: number;
  y: number;
};

export type ViewportPoint = {
  x: number;
  y: number;
};

export type DockPosition = {
  x: number;
  y: number;
};

export const EMPTY_GRAPH: NotebookGraph = {};
export const FEEDBACK_INTENTS: Array<LensAnnotation["intent"]> = [
  "fix",
  "question",
  "explain",
  "approve",
];
export const FEEDBACK_SEVERITIES: Array<LensAnnotation["severity"]> = [
  "important",
  "blocking",
  "suggestion",
];
