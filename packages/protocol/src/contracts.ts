import * as v from "valibot";

import { hasTextContent } from "./bounded-text";

export const WIDGET_TRANSPORT_VERSION = 2;

export type TransportPrimitive = boolean | null | number | string | undefined;
export type TransportRecord = { readonly [key: string]: TransportValue };
export type TransportValue = TransportPrimitive | readonly TransportValue[] | TransportRecord;

const TransportDiscriminatorSchema = v.union([v.boolean(), v.null(), v.number(), v.string()]);

export const TransportEnvelopeSchema = v.looseObject({
  protocol: v.optional(TransportDiscriminatorSchema),
  requestId: v.optional(TransportDiscriminatorSchema),
  type: v.optional(TransportDiscriminatorSchema),
});

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const UnicodeStringSchema = v.pipe(
  v.string(),
  v.check(isValidUnicodeText, "String must contain valid Unicode text"),
);
const NonEmptyStringSchema = v.pipe(
  UnicodeStringSchema,
  v.check(hasTextContent, "String must not be blank"),
);
export const BoundedIdentifierSchema = v.pipe(NonEmptyStringSchema, v.maxLength(128));
const RequestIdSchema = v.pipe(NonEmptyStringSchema, v.maxLength(256));
const TimestampSchema = v.pipe(
  UnicodeStringSchema,
  v.nonEmpty(),
  v.maxLength(64),
  v.regex(TIMESTAMP_PATTERN),
  v.check(hasValidTimestamp, "Timestamp must identify a valid calendar date and time"),
);
const DomFieldSchema = v.pipe(UnicodeStringSchema, v.maxLength(240));
const SelectionImageIdSchema = v.pipe(NonEmptyStringSchema, v.maxLength(134));
const OutputCaptureImageIdSchema = v.pipe(NonEmptyStringSchema, v.maxLength(262));
const FiniteNumberSchema = v.pipe(v.number(), v.finite());
const NormalizedNumberSchema = v.pipe(FiniteNumberSchema, v.minValue(0), v.maxValue(1));
const PositiveNormalizedNumberSchema = v.pipe(
  FiniteNumberSchema,
  v.check((value) => value > 0, "Number must be positive"),
  v.maxValue(1),
);
const PositiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const RevisionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const AttentionDurationSchema = v.pipe(PositiveIntegerSchema, v.maxValue(300_000));
export const SelectionLabelSchema = v.pipe(
  UnicodeStringSchema,
  v.maxLength(16),
  v.regex(/^S[1-9]\d*$/),
);
const AttentionLabelSchema = v.pipe(NonEmptyStringSchema, v.maxLength(40));

export const PointAnchorSchema = v.object({
  kind: v.literal("point"),
  x: NormalizedNumberSchema,
  y: NormalizedNumberSchema,
});

export const RectAnchorSchema = v.pipe(
  v.object({
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
  v.object({
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

export const DomHintSchema = v.object({
  tag: v.pipe(NonEmptyStringSchema, v.maxLength(240)),
  role: v.optional(DomFieldSchema),
  ariaLabel: v.optional(DomFieldSchema),
  title: v.optional(DomFieldSchema),
  text: v.optional(DomFieldSchema),
  path: v.optional(DomFieldSchema),
  bounds: v.optional(DomHintBoundsSchema),
});

export const AvailableSnapshotSchema = v.object({
  status: v.literal("available"),
  id: SelectionImageIdSchema,
  mediaType: v.literal("image/png"),
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
  capturedAt: TimestampSchema,
});

export const OutdatedSnapshotSchema = v.object({
  status: v.literal("outdated"),
  id: SelectionImageIdSchema,
  mediaType: v.literal("image/png"),
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
  capturedAt: TimestampSchema,
});

export const OutputCaptureImageSchema = v.object({
  status: v.literal("available"),
  id: OutputCaptureImageIdSchema,
  mediaType: v.literal("image/png"),
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/)),
  capturedAt: TimestampSchema,
});

export const PendingSnapshotSchema = v.object({
  status: v.literal("pending"),
});

export const FailedSnapshotSchema = v.object({
  status: v.literal("failed"),
  capturedAt: TimestampSchema,
  error: v.optional(v.pipe(UnicodeStringSchema, v.maxLength(500))),
});

export const SelectionSnapshotSchema = v.variant("status", [
  PendingSnapshotSchema,
  AvailableSnapshotSchema,
  OutdatedSnapshotSchema,
  FailedSnapshotSchema,
]);

const SelectionInputObjectSchema = v.object({
  id: BoundedIdentifierSchema,
  label: SelectionLabelSchema,
  note: v.pipe(UnicodeStringSchema, v.maxLength(4_000)),
  outputCellId: BoundedIdentifierSchema,
  createdAt: TimestampSchema,
  anchor: SelectionAnchorSchema,
  domHint: v.optional(DomHintSchema),
  snapshot: SelectionSnapshotSchema,
});

export const PreviousResolutionSchema = v.object({
  addressedAt: TimestampSchema,
  summary: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(240))),
});

export const SelectionInputSchema = v.pipe(
  SelectionInputObjectSchema,
  v.check(
    (selection) =>
      (selection.snapshot.status !== "available" && selection.snapshot.status !== "outdated") ||
      selection.snapshot.id === `image:${selection.id}`,
    "Snapshot id must identify its selection",
  ),
);

export const SelectionSchema = v.intersect([
  SelectionInputSchema,
  v.object({
    previousResolution: v.optional(PreviousResolutionSchema),
  }),
]);

export const AddressedSelectionSchema = v.object({
  selectionId: BoundedIdentifierSchema,
  label: SelectionLabelSchema,
  note: v.pipe(UnicodeStringSchema, v.maxLength(4_000)),
  outputCellId: BoundedIdentifierSchema,
  createdAt: TimestampSchema,
  addressedAt: TimestampSchema,
  anchor: SelectionAnchorSchema,
  domHint: v.optional(DomHintSchema),
  summary: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(240))),
  resolutionRevision: RevisionSchema,
});

const LensStateObjectSchema = v.object({
  revision: RevisionSchema,
  nextLabel: SelectionLabelSchema,
  currentSelectionId: v.nullable(BoundedIdentifierSchema),
  selections: v.pipe(v.array(SelectionSchema), v.maxLength(64)),
  history: v.pipe(v.array(AddressedSelectionSchema), v.maxLength(64)),
});

export const LensStateSchema = v.pipe(
  LensStateObjectSchema,
  v.check((state) => {
    const ids = state.selections.map((selection) => selection.id);
    const labels = state.selections.map((selection) => selection.label);
    return new Set(ids).size === ids.length && new Set(labels).size === labels.length;
  }, "Selection ids and labels must be unique"),
  v.check((state) => {
    const revisions = state.history.map((receipt) => receipt.resolutionRevision);
    const identities = state.history.map(
      (receipt) => `${receipt.selectionId}\u0000${receipt.resolutionRevision}`,
    );
    return (
      new Set(identities).size === identities.length &&
      revisions.every(
        (revision, index) =>
          revision <= state.revision && (index === 0 || revisions[index - 1]! <= revision),
      )
    );
  }, "History selection revisions must be unique and ordered"),
  v.check(
    (state) =>
      state.currentSelectionId === null ||
      state.selections.some((selection) => selection.id === state.currentSelectionId),
    "Current selection must identify a stored selection",
  ),
);

export const ImageActionSchema = v.picklist(["preserve", "replace", "clear"]);
export const StoredSnapshotSchema = v.variant("status", [
  AvailableSnapshotSchema,
  OutdatedSnapshotSchema,
]);

export const SnapshotResponsePayloadSchema = v.object({
  selectionId: BoundedIdentifierSchema,
  snapshot: StoredSnapshotSchema,
});

export const SelectionPutResponsePayloadSchema = v.object({
  selection: SelectionSchema,
});

export const SelectionMutationResponsePayloadSchema = v.object({
  selectionId: BoundedIdentifierSchema,
});

export const ClearSelectionsResponsePayloadSchema = v.object({});

const CommandBaseSchema = {
  protocol: v.literal("marimo-lens.command"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  requestId: RequestIdSchema,
} as const;

export const PutSelectionCommandSchema = v.pipe(
  v.object({
    ...CommandBaseSchema,
    type: v.literal("selection.put"),
    payload: v.object({
      selection: SelectionInputSchema,
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

export const ActivateSelectionCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("selection.activate"),
  payload: v.object({
    selectionId: BoundedIdentifierSchema,
    expectedRevision: RevisionSchema,
  }),
});

export const DeleteSelectionCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("selection.delete"),
  payload: v.object({
    selectionId: BoundedIdentifierSchema,
    expectedRevision: RevisionSchema,
  }),
});

export const ClearSelectionsCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("selections.clear"),
  payload: v.object({
    expectedRevision: RevisionSchema,
  }),
});

export const ReopenSelectionCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("selection.reopen"),
  payload: v.object({
    selectionId: BoundedIdentifierSchema,
    resolutionRevision: RevisionSchema,
    expectedRevision: RevisionSchema,
  }),
});

export const ClearHistoryCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("history.clear"),
  payload: v.object({
    expectedRevision: RevisionSchema,
  }),
});

export const GetSnapshotCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("snapshot.get"),
  payload: v.object({
    selectionId: BoundedIdentifierSchema,
  }),
});

export const OutputCaptureCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("output.capture"),
  payload: v.object({
    outputCellId: BoundedIdentifierSchema,
  }),
});

export const ClientCommandSchema = v.variant("type", [
  PutSelectionCommandSchema,
  ActivateSelectionCommandSchema,
  DeleteSelectionCommandSchema,
  ClearSelectionsCommandSchema,
  ReopenSelectionCommandSchema,
  ClearHistoryCommandSchema,
  GetSnapshotCommandSchema,
]);

export const LensCommandSchema = v.union([ClientCommandSchema, OutputCaptureCommandSchema]);

export const OutputCaptureResponsePayloadSchema = v.object({
  outputCellId: BoundedIdentifierSchema,
  image: OutputCaptureImageSchema,
});

export const OutputCaptureFailurePayloadSchema = v.object({
  outputCellId: BoundedIdentifierSchema,
});

const ResponseBaseSchema = {
  protocol: v.literal("marimo-lens.response"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  requestId: RequestIdSchema,
  revision: RevisionSchema,
  payload: v.record(UnicodeStringSchema, v.unknown()),
} as const;

export const SuccessfulResponseSchema = v.object({
  ...ResponseBaseSchema,
  ok: v.literal(true),
});

export const FailedResponseSchema = v.object({
  ...ResponseBaseSchema,
  ok: v.literal(false),
  error: v.object({
    code: v.pipe(NonEmptyStringSchema, v.maxLength(128)),
    message: v.pipe(NonEmptyStringSchema, v.maxLength(500)),
  }),
});

export const LensResponseSchema = v.variant("ok", [SuccessfulResponseSchema, FailedResponseSchema]);

export const ResolvedSelectionSchema = v.object({
  selectionId: BoundedIdentifierSchema,
  label: SelectionLabelSchema,
  resolutionRevision: RevisionSchema,
});

export const SelectionResolvedEventSchema = v.object({
  protocol: v.literal("marimo-lens.event"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  type: v.literal("selection.resolved"),
  revision: RevisionSchema,
  payload: v.object({
    selections: v.pipe(
      v.array(ResolvedSelectionSchema),
      v.minLength(1),
      v.maxLength(64),
      v.check(
        (selections) =>
          new Set(selections.map((selection) => selection.selectionId)).size === selections.length,
        "Resolved selections must be unique",
      ),
    ),
    summary: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(240))),
  }),
});

const CellRevealPayloadSchema = v.object({
  cellId: BoundedIdentifierSchema,
  durationMs: AttentionDurationSchema,
  label: v.optional(AttentionLabelSchema),
  message: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(1_000))),
});

const CellActivityStartPayloadSchema = v.object({
  cellId: BoundedIdentifierSchema,
  durationMs: v.optional(AttentionDurationSchema),
  label: v.optional(AttentionLabelSchema),
  message: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(240))),
});

const CellActivityStopPayloadSchema = v.object({
  cellId: BoundedIdentifierSchema,
});

export const CellRevealEventSchema = v.object({
  protocol: v.literal("marimo-lens.event"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  type: v.literal("cell.reveal"),
  revision: RevisionSchema,
  payload: CellRevealPayloadSchema,
});

export const CellActivityStartEventSchema = v.object({
  protocol: v.literal("marimo-lens.event"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  type: v.literal("cell.activity.start"),
  revision: RevisionSchema,
  payload: CellActivityStartPayloadSchema,
});

export const CellActivityStopEventSchema = v.object({
  protocol: v.literal("marimo-lens.event"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  type: v.literal("cell.activity.stop"),
  revision: RevisionSchema,
  payload: CellActivityStopPayloadSchema,
});

export type PointAnchor = v.InferOutput<typeof PointAnchorSchema>;
export type RectAnchor = v.InferOutput<typeof RectAnchorSchema>;
export type SelectionAnchor = v.InferOutput<typeof SelectionAnchorSchema>;
export type DomHint = v.InferOutput<typeof DomHintSchema>;
export type DomHintBounds = v.InferOutput<typeof DomHintBoundsSchema>;
export type AvailableSnapshot = v.InferOutput<typeof AvailableSnapshotSchema>;
export type OutputCaptureImage = v.InferOutput<typeof OutputCaptureImageSchema>;
export type OutdatedSnapshot = v.InferOutput<typeof OutdatedSnapshotSchema>;
export type PendingSnapshot = v.InferOutput<typeof PendingSnapshotSchema>;
export type SelectionSnapshot = v.InferOutput<typeof SelectionSnapshotSchema>;
export type PreviousResolution = v.InferOutput<typeof PreviousResolutionSchema>;
export type SelectionInput = v.InferOutput<typeof SelectionInputSchema>;
export type Selection = v.InferOutput<typeof SelectionSchema>;
export type AddressedSelection = v.InferOutput<typeof AddressedSelectionSchema>;
export type LensState = v.InferOutput<typeof LensStateSchema>;
export type ImageAction = v.InferOutput<typeof ImageActionSchema>;
export type StoredSnapshot = v.InferOutput<typeof StoredSnapshotSchema>;
export type SnapshotResponsePayload = v.InferOutput<typeof SnapshotResponsePayloadSchema>;
export type SelectionPutResponsePayload = v.InferOutput<typeof SelectionPutResponsePayloadSchema>;
export type SelectionMutationResponsePayload = v.InferOutput<
  typeof SelectionMutationResponsePayloadSchema
>;
export type ClearSelectionsResponsePayload = v.InferOutput<
  typeof ClearSelectionsResponsePayloadSchema
>;
export type ClientCommand = v.InferOutput<typeof ClientCommandSchema>;
export type OutputCaptureCommand = v.InferOutput<typeof OutputCaptureCommandSchema>;
export type OutputCaptureResponsePayload = v.InferOutput<typeof OutputCaptureResponsePayloadSchema>;
export type OutputCaptureFailurePayload = v.InferOutput<typeof OutputCaptureFailurePayloadSchema>;
export type LensCommand = v.InferOutput<typeof LensCommandSchema>;
export type LensResponse = v.InferOutput<typeof LensResponseSchema>;
export type ResolvedSelection = v.InferOutput<typeof ResolvedSelectionSchema>;
export type SelectionResolvedEvent = v.InferOutput<typeof SelectionResolvedEventSchema>;
export type CellRevealEvent = v.InferOutput<typeof CellRevealEventSchema>;
export type CellActivityStartEvent = v.InferOutput<typeof CellActivityStartEventSchema>;
export type CellActivityStopEvent = v.InferOutput<typeof CellActivityStopEventSchema>;
export type CellAttentionEvent = CellActivityStartEvent | CellActivityStopEvent | CellRevealEvent;
export type TransportEnvelope = v.InferOutput<typeof TransportEnvelopeSchema>;
export type TransportInput =
  | TransportValue
  | LensCommand
  | LensResponse
  | SelectionResolvedEvent
  | CellAttentionEvent;

export type CommandType = ClientCommand["type"];
export type CommandPayload<TType extends CommandType> = Extract<
  ClientCommand,
  { type: TType }
>["payload"];

export function parseContract<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  input: v.InferInput<TSchema> | TransportEnvelope | TransportValue,
  label: string,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input);
  if (result.success) return result.output;
  const messages = result.issues.map((issue) => issue.message).join(", ");
  throw new Error(`${label} failed contract validation: ${messages}`);
}

export function parseTransportEnvelope(input: TransportInput): TransportEnvelope | null {
  const result = v.safeParse(TransportEnvelopeSchema, input);
  return result.success ? result.output : null;
}

export function parseLensState(
  input: v.InferInput<typeof LensStateSchema> | TransportValue,
): LensState {
  return parseContract(LensStateSchema, input, "Lens state");
}

export function parseLensResponse(
  input: v.InferInput<typeof LensResponseSchema> | TransportEnvelope | TransportValue,
): LensResponse {
  return parseContract(LensResponseSchema, input, "Lens response");
}

export function parseOutputCaptureCommand(
  input: v.InferInput<typeof OutputCaptureCommandSchema> | TransportEnvelope | TransportValue,
): OutputCaptureCommand {
  return parseContract(OutputCaptureCommandSchema, input, "Output capture command");
}

export function parseSelectionResolvedEvent(
  input: v.InferInput<typeof SelectionResolvedEventSchema> | TransportEnvelope | TransportValue,
): SelectionResolvedEvent {
  return parseContract(SelectionResolvedEventSchema, input, "Lens resolution event");
}

export function parseCellRevealEvent(
  input: v.InferInput<typeof CellRevealEventSchema> | TransportEnvelope | TransportValue,
): CellRevealEvent {
  return parseContract(CellRevealEventSchema, input, "Lens cell reveal event");
}

export function parseCellActivityStartEvent(
  input: v.InferInput<typeof CellActivityStartEventSchema> | TransportEnvelope | TransportValue,
): CellActivityStartEvent {
  return parseContract(CellActivityStartEventSchema, input, "Lens cell activity start event");
}

export function parseCellActivityStopEvent(
  input: v.InferInput<typeof CellActivityStopEventSchema> | TransportEnvelope | TransportValue,
): CellActivityStopEvent {
  return parseContract(CellActivityStopEventSchema, input, "Lens cell activity stop event");
}

function isValidUnicodeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasValidTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  if (year === 0) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    day >= 1 &&
    day <= (days[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}
