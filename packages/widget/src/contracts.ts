import * as v from "valibot";

const NonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());
const FiniteNumberSchema = v.pipe(v.number(), v.finite());
const NormalizedNumberSchema = v.pipe(FiniteNumberSchema, v.minValue(0), v.maxValue(1));
const PositiveNormalizedNumberSchema = v.pipe(
  FiniteNumberSchema,
  v.minValue(Number.EPSILON),
  v.maxValue(1),
);
const PositiveIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
const RevisionSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
export const SelectionLabelSchema = v.pipe(v.string(), v.regex(/^S[1-9]\d*$/));

export const PointAnchorSchema = v.strictObject({
  kind: v.literal("point"),
  x: NormalizedNumberSchema,
  y: NormalizedNumberSchema,
});

export const RectAnchorSchema = v.pipe(
  v.strictObject({
    kind: v.literal("rect"),
    x: NormalizedNumberSchema,
    y: NormalizedNumberSchema,
    width: PositiveNormalizedNumberSchema,
    height: PositiveNormalizedNumberSchema,
  }),
  v.check(
    (anchor) => anchor.x + anchor.width <= 1 && anchor.y + anchor.height <= 1,
    "Selection rectangle extends beyond its output cell",
  ),
);

export const SelectionAnchorSchema = v.variant("kind", [PointAnchorSchema, RectAnchorSchema]);

export const DomHintBoundsSchema = v.pipe(
  v.strictObject({
    x: NormalizedNumberSchema,
    y: NormalizedNumberSchema,
    width: NormalizedNumberSchema,
    height: NormalizedNumberSchema,
  }),
  v.check(
    (bounds) => bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1,
    "DOM hint bounds extend beyond their output cell",
  ),
);

export const DomHintSchema = v.strictObject({
  tag: NonEmptyStringSchema,
  role: v.optional(v.string()),
  ariaLabel: v.optional(v.string()),
  title: v.optional(v.string()),
  text: v.optional(v.string()),
  path: v.optional(v.string()),
  bounds: v.optional(DomHintBoundsSchema),
});

export const AvailableSnapshotSchema = v.strictObject({
  status: v.literal("available"),
  id: NonEmptyStringSchema,
  mediaType: v.literal("image/png"),
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
  capturedAt: NonEmptyStringSchema,
});

export const OutdatedSnapshotSchema = v.strictObject({
  status: v.literal("outdated"),
  id: NonEmptyStringSchema,
  mediaType: v.literal("image/png"),
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
  capturedAt: NonEmptyStringSchema,
});

export const PendingSnapshotSchema = v.strictObject({
  status: v.literal("pending"),
});

export const FailedSnapshotSchema = v.strictObject({
  status: v.literal("failed"),
  capturedAt: NonEmptyStringSchema,
  error: v.optional(v.string()),
});

export const SelectionSnapshotSchema = v.variant("status", [
  PendingSnapshotSchema,
  AvailableSnapshotSchema,
  OutdatedSnapshotSchema,
  FailedSnapshotSchema,
]);

const SelectionObjectSchema = v.strictObject({
  id: NonEmptyStringSchema,
  label: SelectionLabelSchema,
  note: v.pipe(v.string(), v.maxLength(4_000)),
  outputCellId: NonEmptyStringSchema,
  createdAt: NonEmptyStringSchema,
  anchor: SelectionAnchorSchema,
  domHint: v.optional(DomHintSchema),
  snapshot: SelectionSnapshotSchema,
});

export const SelectionSchema = v.pipe(
  SelectionObjectSchema,
  v.check(
    (selection) =>
      (selection.snapshot.status !== "available" && selection.snapshot.status !== "outdated") ||
      selection.snapshot.id === `image:${selection.id}`,
    "Snapshot id must identify its selection",
  ),
);

const LensStateObjectSchema = v.strictObject({
  revision: RevisionSchema,
  nextLabel: v.pipe(v.string(), v.regex(/^S[1-9]\d*$/)),
  currentSelectionId: v.nullable(NonEmptyStringSchema),
  selections: v.array(SelectionSchema),
});

export const LensStateSchema = v.pipe(
  LensStateObjectSchema,
  v.check((state) => {
    const ids = state.selections.map((selection) => selection.id);
    const labels = state.selections.map((selection) => selection.label);
    return new Set(ids).size === ids.length && new Set(labels).size === labels.length;
  }, "Selection ids and labels must be unique"),
  v.check(
    (state) =>
      state.currentSelectionId === null ||
      state.selections.some((selection) => selection.id === state.currentSelectionId),
    "Current selection must identify a stored selection",
  ),
);

export const ImageActionSchema = v.picklist(["preserve", "replace", "clear"]);
export const ContextExportFormatSchema = v.picklist(["current", "references", "text"]);
export const StoredSnapshotSchema = v.variant("status", [
  AvailableSnapshotSchema,
  OutdatedSnapshotSchema,
]);

export const SnapshotResponsePayloadSchema = v.strictObject({
  selectionId: NonEmptyStringSchema,
  snapshot: StoredSnapshotSchema,
});

const CommandBaseSchema = {
  protocol: v.literal("marimo-lens.command"),
  version: v.literal(1),
  requestId: NonEmptyStringSchema,
} as const;

export const PutSelectionCommandSchema = v.pipe(
  v.strictObject({
    ...CommandBaseSchema,
    type: v.literal("selection.put"),
    payload: v.strictObject({
      selection: SelectionSchema,
      imageAction: ImageActionSchema,
      expectedRevision: RevisionSchema,
    }),
  }),
  v.check(({ payload }) => {
    const status = payload.selection.snapshot.status;
    if (payload.imageAction === "replace") return status === "available";
    if (payload.imageAction === "clear") return status === "pending" || status === "failed";
    return true;
  }, "Snapshot status does not match imageAction"),
);

export const ActivateSelectionCommandSchema = v.strictObject({
  ...CommandBaseSchema,
  type: v.literal("selection.activate"),
  payload: v.strictObject({
    selectionId: NonEmptyStringSchema,
    expectedRevision: RevisionSchema,
  }),
});

export const DeleteSelectionCommandSchema = v.strictObject({
  ...CommandBaseSchema,
  type: v.literal("selection.delete"),
  payload: v.strictObject({
    selectionId: NonEmptyStringSchema,
    expectedRevision: RevisionSchema,
  }),
});

export const ClearSelectionsCommandSchema = v.strictObject({
  ...CommandBaseSchema,
  type: v.literal("selections.clear"),
  payload: v.strictObject({
    expectedRevision: RevisionSchema,
  }),
});

export const ExportContextCommandSchema = v.strictObject({
  ...CommandBaseSchema,
  type: v.literal("context.export"),
  payload: v.strictObject({
    format: ContextExportFormatSchema,
  }),
});

export const GetSnapshotCommandSchema = v.strictObject({
  ...CommandBaseSchema,
  type: v.literal("snapshot.get"),
  payload: v.strictObject({
    selectionId: NonEmptyStringSchema,
  }),
});

export const LensCommandSchema = v.variant("type", [
  PutSelectionCommandSchema,
  ActivateSelectionCommandSchema,
  DeleteSelectionCommandSchema,
  ClearSelectionsCommandSchema,
  ExportContextCommandSchema,
  GetSnapshotCommandSchema,
]);

const ResponseBaseSchema = {
  protocol: v.literal("marimo-lens.response"),
  version: v.literal(1),
  requestId: NonEmptyStringSchema,
  revision: RevisionSchema,
  payload: v.record(v.string(), v.unknown()),
} as const;

export const SuccessfulResponseSchema = v.strictObject({
  ...ResponseBaseSchema,
  ok: v.literal(true),
});

export const FailedResponseSchema = v.strictObject({
  ...ResponseBaseSchema,
  ok: v.literal(false),
  error: v.strictObject({
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
  }),
});

export const LensResponseSchema = v.variant("ok", [SuccessfulResponseSchema, FailedResponseSchema]);

export const SelectionResolvedEventSchema = v.strictObject({
  protocol: v.literal("marimo-lens.event"),
  version: v.literal(1),
  type: v.literal("selection.resolved"),
  revision: RevisionSchema,
  payload: v.strictObject({
    selectionId: NonEmptyStringSchema,
    label: SelectionLabelSchema,
    summary: v.optional(v.pipe(v.string(), v.nonEmpty(), v.maxLength(240))),
  }),
});

export type PointAnchor = v.InferOutput<typeof PointAnchorSchema>;
export type RectAnchor = v.InferOutput<typeof RectAnchorSchema>;
export type SelectionAnchor = v.InferOutput<typeof SelectionAnchorSchema>;
export type DomHint = v.InferOutput<typeof DomHintSchema>;
export type DomHintBounds = v.InferOutput<typeof DomHintBoundsSchema>;
export type AvailableSnapshot = v.InferOutput<typeof AvailableSnapshotSchema>;
export type OutdatedSnapshot = v.InferOutput<typeof OutdatedSnapshotSchema>;
export type PendingSnapshot = v.InferOutput<typeof PendingSnapshotSchema>;
export type SelectionSnapshot = v.InferOutput<typeof SelectionSnapshotSchema>;
export type Selection = v.InferOutput<typeof SelectionSchema>;
export type LensState = v.InferOutput<typeof LensStateSchema>;
export type ImageAction = v.InferOutput<typeof ImageActionSchema>;
export type ContextExportFormat = v.InferOutput<typeof ContextExportFormatSchema>;
export type StoredSnapshot = v.InferOutput<typeof StoredSnapshotSchema>;
export type SnapshotResponsePayload = v.InferOutput<typeof SnapshotResponsePayloadSchema>;
export type LensCommand = v.InferOutput<typeof LensCommandSchema>;
export type LensResponse = v.InferOutput<typeof LensResponseSchema>;
export type SelectionResolvedEvent = v.InferOutput<typeof SelectionResolvedEventSchema>;

export type CommandType = LensCommand["type"];
export type CommandPayload<TType extends CommandType> = Extract<
  LensCommand,
  { type: TType }
>["payload"];

export function parseContract<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  input: unknown,
  label: string,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input);
  if (result.success) return result.output;
  const messages = result.issues.map((issue) => issue.message).join(", ");
  throw new Error(`${label} failed contract validation: ${messages}`);
}

export function parseLensState(input: unknown): LensState {
  return parseContract(LensStateSchema, input, "Lens state");
}

export function parseLensResponse(input: unknown): LensResponse {
  return parseContract(LensResponseSchema, input, "Lens response");
}

export function parseSelectionResolvedEvent(input: unknown): SelectionResolvedEvent {
  return parseContract(SelectionResolvedEventSchema, input, "Lens resolution event");
}
