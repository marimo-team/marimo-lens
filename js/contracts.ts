import * as v from "valibot";

import {
  AGENT_ANNOTATION_STATUSES,
  AGENT_CELL_MARK_STATUSES,
  AGENT_FINISH_STATUSES,
  CAPABILITY_KEYS,
  CHART_PART_KINDS,
  FEEDBACK_INTENTS,
  FEEDBACK_SEVERITIES,
  LENS_TARGET_KINDS,
  SELECTION_GRANULARITIES,
  SELECTION_SURFACES,
} from "@/selection/target-contract";

const UnknownRecordSchema = v.record(v.string(), v.unknown());
const StringArraySchema = v.array(v.string());
const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const SelectionUnitKindSchema = v.pipe(
  v.string(),
  v.nonEmpty("selectionModel unit kind is missing"),
);
const PointSchema = v.strictObject({ x: v.number(), y: v.number() });
const RectSchema = v.strictObject({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

export const TargetKindSchema = v.picklist(LENS_TARGET_KINDS, "unknown target kind");
export const SelectionSurfaceSchema = v.picklist(SELECTION_SURFACES, "unknown selection surface");
export const SelectionGranularitySchema = v.picklist(
  SELECTION_GRANULARITIES,
  "unknown selection granularity",
);
export const ChartPartKindSchema = v.picklist(CHART_PART_KINDS, "unknown chart part kind");

export const LensColumnSchema = v.looseObject({
  name: NonEmptyStringSchema,
  dtype: v.optional(v.nullish(v.string())),
  metadata: v.optional(UnknownRecordSchema),
});

export const TargetCapabilitiesSchema = v.strictObject(
  v.entriesFromList(CAPABILITY_KEYS, v.optional(v.boolean())),
  "unknown capability",
);

export const SelectionModelUnitSchema = v.strictObject({
  kind: SelectionUnitKindSchema,
  id: v.optional(v.string()),
  label: v.optional(v.string()),
  granularity: v.optional(SelectionGranularitySchema),
  parentId: v.optional(v.string()),
  supported: v.optional(v.boolean()),
  requires: v.optional(StringArraySchema),
  selectors: v.optional(StringArraySchema),
  fallbackFor: v.optional(StringArraySchema),
  match: v.optional(UnknownRecordSchema),
  priority: v.optional(v.number()),
  data: v.optional(UnknownRecordSchema),
});

export const SelectionModelSchema = v.strictObject({
  units: v.array(SelectionModelUnitSchema),
  defaultFallback: v.optional(v.string()),
});

export const LensChartPartSchema = v.strictObject({
  library: v.optional(v.string()),
  kind: ChartPartKindSchema,
  label: NonEmptyStringSchema,
  id: v.optional(v.string()),
  detail: v.optional(v.string()),
  channel: v.optional(v.string()),
  field: v.optional(v.string()),
  orientation: v.optional(v.string()),
  selector: v.optional(v.string()),
  datum: v.optional(UnknownRecordSchema),
  context: v.optional(UnknownRecordSchema),
  extensions: v.optional(UnknownRecordSchema),
});

export const LensChartMetadataSchema = v.strictObject({
  library: v.optional(v.string()),
  parts: v.optional(v.array(LensChartPartSchema)),
  renderer: v.optional(v.string()),
  axesCount: v.optional(v.number()),
  traceCount: v.optional(v.number()),
  encoding: v.optional(UnknownRecordSchema),
  mark: v.optional(v.union([v.string(), UnknownRecordSchema])),
  extensions: v.optional(UnknownRecordSchema),
});

export const LensTargetSchema = v.strictObject(
  {
    id: NonEmptyStringSchema,
    variable: v.optional(v.string()),
    label: NonEmptyStringSchema,
    kind: TargetKindSchema,
    cellId: v.optional(v.nullish(v.string())),
    displayCellIds: v.optional(StringArraySchema),
    relatedCellIds: v.optional(StringArraySchema),
    defs: v.optional(StringArraySchema),
    refs: v.optional(StringArraySchema),
    shape: v.optional(
      v.nullish(
        v.strictObject({
          rows: v.optional(v.number()),
          columns: v.optional(v.number()),
        }),
      ),
    ),
    columns: v.optional(v.array(LensColumnSchema)),
    chart: v.optional(v.nullish(LensChartMetadataSchema)),
    component: v.optional(v.string()),
    entity: v.optional(
      v.strictObject({
        inspector: v.string(),
        family: v.string(),
        source: v.optional(v.string()),
      }),
    ),
    capabilities: v.optional(TargetCapabilitiesSchema),
    selectionPolicy: v.optional(
      v.strictObject({
        prefer: v.optional(v.array(SelectionSurfaceSchema)),
        context: v.optional(UnknownRecordSchema),
      }),
    ),
    selectionModel: v.optional(SelectionModelSchema),
    summary: v.optional(v.string()),
    selectors: v.optional(StringArraySchema),
    pythonType: v.optional(v.string()),
    output: v.optional(
      v.strictObject({
        kind: v.optional(v.string()),
        type: v.optional(v.string()),
        cellId: v.optional(v.string()),
        codePreview: v.optional(v.string()),
      }),
    ),
    outputRefs: v.optional(StringArraySchema),
    outputType: v.optional(v.string()),
    codePreview: v.optional(v.string()),
    extensions: v.optional(UnknownRecordSchema),
  },
  "unknown target contract key",
);

export const LensTargetArraySchema = v.array(LensTargetSchema);

export const RuntimeControlSchema = v.strictObject({
  name: v.string(),
  kind: v.picklist(["anywidget", "traitlets", "ui"]),
  component: v.optional(v.string()),
  pythonType: v.string(),
  cellIds: v.optional(StringArraySchema),
  elementId: v.optional(v.string()),
  label: v.optional(v.string()),
  modelId: v.optional(v.string()),
  value: v.optional(v.unknown()),
  initialValue: v.optional(v.unknown()),
  frontendValue: v.optional(v.unknown()),
  args: v.optional(UnknownRecordSchema),
  traits: v.optional(StringArraySchema),
  state: v.optional(UnknownRecordSchema),
  lens: v.optional(
    v.nullish(
      v.strictObject({
        parentId: v.string(),
        key: v.string(),
      }),
    ),
  ),
  widget: v.optional(UnknownRecordSchema),
  summary: v.optional(v.string()),
});

export const NotebookGraphSchema = v.strictObject({
  available: v.optional(v.boolean()),
  collectedAt: v.optional(v.string()),
  currentCellId: v.optional(v.string()),
  filename: v.optional(v.string()),
  cells: v.optional(
    v.array(
      v.strictObject({
        id: v.string(),
        defs: StringArraySchema,
        refs: StringArraySchema,
        outputRefs: v.optional(StringArraySchema),
        output: v.optional(v.unknown()),
        outputType: v.optional(v.string()),
        hasOutputExpression: v.optional(v.boolean()),
        language: v.optional(v.string()),
        status: v.optional(v.string()),
        stale: v.optional(v.boolean()),
        disabled: v.optional(v.boolean()),
        codePreview: v.optional(v.string()),
      }),
    ),
  ),
  definitions: v.optional(v.record(v.string(), StringArraySchema)),
  edges: v.optional(v.array(v.strictObject({ from: v.string(), to: v.string() }))),
  globals: v.optional(
    v.array(
      v.strictObject({
        name: v.string(),
        kind: v.string(),
        pythonType: v.string(),
        cellIds: StringArraySchema,
        shape: v.optional(
          v.nullish(
            v.strictObject({
              rows: v.optional(v.number()),
              columns: v.optional(v.number()),
            }),
          ),
        ),
        columns: v.optional(v.array(LensColumnSchema)),
        chart: v.optional(v.nullish(LensChartMetadataSchema)),
        summary: v.optional(v.string()),
        entity: v.optional(
          v.strictObject({
            inspector: v.string(),
            family: v.string(),
          }),
        ),
      }),
    ),
  ),
  controls: v.optional(
    v.strictObject({
      summary: v.optional(
        v.strictObject({
          uiElementCount: v.optional(v.number()),
          widgetCount: v.optional(v.number()),
          traitletsObjectCount: v.optional(v.number()),
          errorCount: v.optional(v.number()),
          capturedUiElementCount: v.optional(v.number()),
          capturedWidgetCount: v.optional(v.number()),
          capturedTraitletsObjectCount: v.optional(v.number()),
          capturedErrorCount: v.optional(v.number()),
        }),
      ),
      uiElements: v.optional(v.array(RuntimeControlSchema)),
      widgets: v.optional(v.array(RuntimeControlSchema)),
      traitletsObjects: v.optional(v.array(RuntimeControlSchema)),
      errors: v.optional(
        v.array(
          v.strictObject({
            name: v.string(),
            pythonType: v.string(),
            error: v.string(),
          }),
        ),
      ),
    }),
  ),
  runtime: v.optional(
    v.strictObject({
      sessionMode: v.optional(v.string()),
      lazy: v.optional(v.boolean()),
      queryParams: v.optional(UnknownRecordSchema),
      argv: v.optional(v.array(v.unknown())),
    }),
  ),
  reason: v.optional(v.string()),
});

export const SerializedSelectionEvidenceSchema = v.looseObject({
  kind: v.string(),
  hitKind: v.optional(v.string()),
  selector: v.optional(v.string()),
  elementName: v.optional(v.string()),
  column: v.optional(v.string()),
  rowIndex: v.optional(v.number()),
  data: v.optional(UnknownRecordSchema),
});

export const SerializedSemanticSelectionSchema = v.strictObject({
  id: v.string(),
  targetId: v.string(),
  kind: v.string(),
  granularity: SelectionGranularitySchema,
  label: v.string(),
  parentId: v.optional(v.string()),
  data: v.optional(UnknownRecordSchema),
  evidence: v.array(SerializedSelectionEvidenceSchema),
  highlight: v.strictObject({
    kind: v.picklist(["element", "elements", "rect"]),
    strategy: v.optional(v.string()),
    padding: v.optional(v.number()),
    boundingBox: v.optional(RectSchema),
  }),
  anchor: v.looseObject({
    rootCellId: v.optional(v.nullish(v.string())),
    selector: v.optional(v.string()),
    point: v.optional(PointSchema),
    data: v.optional(UnknownRecordSchema),
  }),
});

export const LensAnnotationAnchorSchema = v.strictObject({
  version: v.literal(1),
  fixed: v.boolean(),
  rootCellId: v.optional(v.nullish(v.string())),
  elementPath: v.optional(v.string()),
  selectorPath: v.optional(
    v.array(
      v.strictObject({
        selector: v.string(),
        shadow: v.optional(v.boolean()),
      }),
    ),
  ),
  elementOffset: v.optional(PointSchema),
  cellOffset: v.optional(PointSchema),
  viewportPoint: v.optional(PointSchema),
  documentPoint: PointSchema,
});

export const DomEvidenceSchema = v.strictObject({
  element: v.optional(v.string(), ""),
  elementPath: v.optional(v.string(), ""),
  documentPoint: v.optional(PointSchema),
  boundingBox: v.optional(RectSchema),
});

export const FeedbackIntentSchema = v.picklist(FEEDBACK_INTENTS);
export const FeedbackSeveritySchema = v.picklist(FEEDBACK_SEVERITIES);

export const LensAnnotationSchema = v.strictObject({
  id: v.string(),
  targetId: v.string(),
  targetLabel: v.optional(v.string()),
  targetSnapshot: v.optional(LensTargetSchema),
  variable: v.optional(v.string()),
  kind: v.optional(v.string()),
  column: v.optional(v.string()),
  columnDtype: v.optional(v.nullish(v.string())),
  chartPart: v.optional(v.nullish(LensChartPartSchema)),
  cellId: v.optional(v.nullish(v.string())),
  displayCellId: v.optional(v.nullish(v.string())),
  comment: v.string(),
  intent: v.optional(FeedbackIntentSchema, "fix"),
  severity: v.optional(FeedbackSeveritySchema, "important"),
  element: v.optional(v.string(), ""),
  elementPath: v.optional(v.string(), ""),
  documentX: v.optional(v.number(), 0),
  documentY: v.optional(v.number(), 0),
  boundingBox: v.optional(RectSchema, { x: 0, y: 0, width: 0, height: 0 }),
  domEvidence: v.optional(DomEvidenceSchema),
  anchor: v.optional(LensAnnotationAnchorSchema),
  semanticSelection: v.optional(SerializedSemanticSelectionSchema),
  createdAt: v.optional(v.string(), ""),
  context: v.optional(UnknownRecordSchema),
});

export const LensAnnotationArraySchema = v.array(LensAnnotationSchema);

export const AgentActorSchema = v.strictObject({
  type: v.literal("agent"),
  label: v.string(),
  runId: v.string(),
});

export const AgentProvenanceSchema = v.strictObject({
  origin: v.literal("agent"),
  source: v.string(),
  protocol: v.string(),
  version: v.number(),
});

const AgentActivityBaseSchema = {
  id: v.string(),
  actor: AgentActorSchema,
  createdAt: v.string(),
  note: v.optional(v.string()),
  details: v.optional(UnknownRecordSchema),
  provenance: AgentProvenanceSchema,
} as const;

export const AgentStartedActivitySchema = v.strictObject({
  ...AgentActivityBaseSchema,
  kind: v.literal("agent-started"),
  status: v.literal("started"),
  cellIds: v.optional(StringArraySchema),
  annotationIds: v.optional(StringArraySchema),
});

export const AgentFinishedActivitySchema = v.strictObject({
  ...AgentActivityBaseSchema,
  kind: v.literal("agent-finished"),
  status: v.picklist(AGENT_FINISH_STATUSES),
  cellIds: StringArraySchema,
  annotationIds: StringArraySchema,
});

export const AgentCellMarkActivitySchema = v.strictObject({
  ...AgentActivityBaseSchema,
  kind: v.literal("cell-mark"),
  status: v.picklist(AGENT_CELL_MARK_STATUSES),
  cellIds: StringArraySchema,
  annotationIds: v.optional(StringArraySchema),
});

export const AgentAnnotationStatusActivitySchema = v.strictObject({
  ...AgentActivityBaseSchema,
  kind: v.literal("annotation-status"),
  status: v.picklist(AGENT_ANNOTATION_STATUSES),
  cellIds: v.optional(StringArraySchema),
  annotationIds: StringArraySchema,
});

export const AgentActivitySchema = v.variant("kind", [
  AgentStartedActivitySchema,
  AgentFinishedActivitySchema,
  AgentCellMarkActivitySchema,
  AgentAnnotationStatusActivitySchema,
]);

export const AgentActivityArraySchema = v.array(AgentActivitySchema);

export const AgentCommandSchema = v.strictObject({
  id: v.string(),
  kind: v.literal("focus-cell"),
  createdAt: v.string(),
  cellId: v.string(),
  reason: v.optional(v.string()),
  provenance: AgentProvenanceSchema,
});

export const AgentCommandArraySchema = v.array(AgentCommandSchema);

export const PairResultSchema = v.strictObject({
  protocol: v.optional(v.literal("marimo-pair.result")),
  version: v.optional(v.number()),
  source: v.optional(
    v.strictObject({
      package: v.optional(v.string()),
      agent: v.optional(v.string()),
    }),
  ),
  summary: v.optional(
    v.strictObject({
      cellsRead: v.optional(v.number()),
      cellsEdited: v.optional(v.number()),
      cellsRun: v.optional(v.number()),
      annotationsAddressed: v.optional(v.number()),
    }),
  ),
  activity: v.optional(AgentActivityArraySchema),
  openQuestions: v.optional(v.array(v.unknown())),
  warnings: v.optional(v.array(v.unknown())),
});

export const PairFeedbackAnnotationSchema = v.strictObject({
  id: v.string(),
  index: v.number(),
  createdAt: v.string(),
  severity: FeedbackSeveritySchema,
  intent: FeedbackIntentSchema,
  request: v.string(),
  target: v.strictObject({
    id: v.string(),
    label: v.string(),
    variable: v.string(),
    kind: TargetKindSchema,
    status: v.picklist(["current", "snapshot", "missing", "invalid-snapshot"]),
    column: v.string(),
    columnDtype: v.string(),
    chartPart: v.nullish(LensChartPartSchema),
    semanticSelection: v.nullish(SerializedSemanticSelectionSchema),
    pythonType: v.string(),
    summary: v.string(),
    shape: v.optional(
      v.nullish(
        v.strictObject({
          rows: v.optional(v.number()),
          columns: v.optional(v.number()),
        }),
      ),
    ),
    defs: StringArraySchema,
    refs: StringArraySchema,
    output: v.optional(UnknownRecordSchema),
    outputType: v.string(),
    codePreview: v.string(),
  }),
  targetSnapshot: LensTargetSchema,
  cells: v.strictObject({
    definition: v.string(),
    display: v.string(),
    output: v.string(),
    editFocus: v.string(),
    related: StringArraySchema,
    downstream: StringArraySchema,
    previews: v.array(
      v.strictObject({
        id: v.string(),
        defs: StringArraySchema,
        refs: StringArraySchema,
        outputRefs: StringArraySchema,
        hasOutputExpression: v.boolean(),
        status: v.string(),
        stale: v.boolean(),
        disabled: v.boolean(),
        codePreview: v.string(),
      }),
    ),
  }),
  evidence: v.strictObject({
    element: v.string(),
    elementPath: v.string(),
    semanticSelection: v.nullish(SerializedSemanticSelectionSchema),
    documentPoint: PointSchema,
    boundingBox: RectSchema,
    context: v.optional(UnknownRecordSchema),
  }),
  marimoPair: v.strictObject({
    action: FeedbackIntentSchema,
    requiresClarification: v.boolean(),
    editBoundary: v.strictObject({
      mode: v.literal("marimo-code-mode"),
      cellIds: StringArraySchema,
      smallestSafeSurface: v.literal("full-cell-body"),
    }),
    readBeforeEdit: StringArraySchema,
    runAfterEdit: StringArraySchema,
    reportingProtocol: UnknownRecordSchema,
    recommendedAction: v.string(),
    needsClarification: v.boolean(),
    suggestedFocus: v.string(),
    editGuardrail: v.string(),
  }),
});

export const PairFeedbackSchema = v.strictObject({
  protocol: v.literal("marimo-pair.feedback"),
  version: v.number(),
  generatedAt: v.string(),
  source: v.strictObject({
    package: v.string(),
    title: v.string(),
  }),
  notebook: v.optional(NotebookGraphSchema),
  targets: v.array(LensTargetSchema),
  targetIndex: v.record(v.string(), UnknownRecordSchema),
  displayProvenance: v.array(UnknownRecordSchema),
  contextPolicy: UnknownRecordSchema,
  summary: UnknownRecordSchema,
  groups: v.array(UnknownRecordSchema),
  instructions: StringArraySchema,
  annotations: v.array(PairFeedbackAnnotationSchema),
  markdown: v.string(),
  extensions: v.optional(UnknownRecordSchema),
});

export const RefreshStateSchema = v.strictObject({
  requestId: v.optional(v.string()),
  status: v.optional(v.picklist(["idle", "running", "success", "error"])),
  error: v.optional(v.string()),
  contextRevision: v.optional(v.number()),
  pairPromptRevision: v.optional(v.number()),
});

export type LensTargetKind = v.InferOutput<typeof TargetKindSchema>;
export type SelectionSurface = v.InferOutput<typeof SelectionSurfaceSchema>;
export type SelectionGranularity = v.InferOutput<typeof SelectionGranularitySchema>;
export type LensChartPartKind = v.InferOutput<typeof ChartPartKindSchema>;
export type LensColumn = v.InferOutput<typeof LensColumnSchema>;
export type SelectionModelUnit = v.InferOutput<typeof SelectionModelUnitSchema>;
export type SelectionModel = v.InferOutput<typeof SelectionModelSchema>;
export type LensChartLibrary = string;
export type LensChartPart = v.InferOutput<typeof LensChartPartSchema>;
export type LensChartMetadata = v.InferOutput<typeof LensChartMetadataSchema>;
export type LensTarget = v.InferOutput<typeof LensTargetSchema>;
export type RuntimeControlKind = v.InferOutput<typeof RuntimeControlSchema>["kind"];
export type RuntimeControl = v.InferOutput<typeof RuntimeControlSchema>;
export type NotebookGraph = v.InferOutput<typeof NotebookGraphSchema>;
export type SerializedSelectionEvidence = v.InferOutput<typeof SerializedSelectionEvidenceSchema>;
export type SerializedSemanticSelection = v.InferOutput<typeof SerializedSemanticSelectionSchema>;
export type LensAnnotationAnchor = v.InferOutput<typeof LensAnnotationAnchorSchema>;
export type DomEvidence = v.InferOutput<typeof DomEvidenceSchema>;
export type LensAnnotation = v.InferOutput<typeof LensAnnotationSchema>;
export type AgentActivityKind = v.InferOutput<typeof AgentActivitySchema>["kind"];
export type AgentCellMarkKind = "read" | "claimed" | "edited" | "ran" | "failed" | "needs-review";
export type AgentActivity = v.InferOutput<typeof AgentActivitySchema>;
export type AgentCommand = v.InferOutput<typeof AgentCommandSchema>;
export type PairResult = v.InferOutput<typeof PairResultSchema>;
export type PairFeedbackAnnotation = v.InferOutput<typeof PairFeedbackAnnotationSchema>;
export type PairFeedback = v.InferOutput<typeof PairFeedbackSchema>;
export type RefreshState = v.InferOutput<typeof RefreshStateSchema>;

export function parseContract<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  input: unknown,
  label: string,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input);
  if (result.success) return result.output;
  const messages = result.issues.map(formatContractIssue).join("; ");
  throw new Error(`${label} failed contract validation: ${messages}`);
}

function formatContractIssue(issue: v.BaseIssue<unknown>): string {
  const keys = issue.path?.map((item) => item.key) ?? [];
  if (keys.includes("selectionPolicy") && keys.includes("prefer")) {
    return "unknown selection surface";
  }
  if (keys.includes("chart") && keys.includes("parts") && keys.at(-1) === "kind") {
    return "unknown chart part kind";
  }
  const unitsIndex = keys.indexOf("units");
  if (
    keys.includes("selectionModel") &&
    unitsIndex >= 0 &&
    keys.at(-1) === "kind" &&
    issue.input === undefined
  ) {
    const unitIndex = keys[unitsIndex + 1];
    return `Expected "kind"; selectionModel unit ${
      typeof unitIndex === "number" ? unitIndex : 0
    } is missing kind`;
  }
  return issue.message;
}

export function normalizeLensTargets(input: unknown): LensTarget[] {
  if (input === undefined || input === null) return [];
  return parseContract(LensTargetArraySchema, input, "Lens targets");
}

export function normalizeLensAnnotations(input: unknown): LensAnnotation[] {
  if (input === undefined || input === null) return [];
  return parseContract(LensAnnotationArraySchema, input, "Lens annotations");
}

export function normalizeNotebookGraph(input: unknown): NotebookGraph {
  if (input === undefined || input === null) return {};
  return parseContract(NotebookGraphSchema, input, "Lens notebook graph");
}

export function normalizeAgentActivity(input: unknown): AgentActivity[] {
  if (input === undefined || input === null) return [];
  return parseContract(AgentActivityArraySchema, input, "Lens agent activity");
}

export function normalizeAgentCommands(input: unknown): AgentCommand[] {
  if (input === undefined || input === null) return [];
  return parseContract(AgentCommandArraySchema, input, "Lens agent commands");
}

export function normalizePairResult(input: unknown): PairResult {
  if (input === undefined || input === null) return {};
  return parseContract(PairResultSchema, input, "Lens pair result");
}

export function normalizePairFeedback(input: unknown): PairFeedback | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "object" && !Array.isArray(input) && input !== null) {
    const protocol = (input as { protocol?: unknown }).protocol;
    if (protocol === undefined || protocol === null || protocol === "") return null;
  }
  return parseContract(PairFeedbackSchema, input, "Lens pair feedback");
}

export function normalizeRefreshState(input: unknown): RefreshState {
  if (input === undefined || input === null) return {};
  return parseContract(RefreshStateSchema, input, "Lens refresh state");
}
