import * as v from "valibot";

import type { TransportValue } from "./transport";

import {
  BoundedIdentifierSchema,
  DomFieldSchema,
  DomSelectorSchema,
  NonEmptyStringSchema,
  NormalizedNumberSchema,
  PositiveIntegerSchema,
  PositiveNormalizedNumberSchema,
  RevisionSchema,
  SecondsSchema,
  SelectionImageIdSchema,
  SelectionLabelSchema,
  StoredImageEntries,
  TimestampSchema,
  UnicodeStringSchema,
  parseContract,
} from "./transport";

const PointAnchorSchema = v.object({
  kind: v.literal("point"),
  x: NormalizedNumberSchema,
  y: NormalizedNumberSchema,
});

const RectAnchorSchema = v.pipe(
  v.object({
    kind: v.literal("rect"),
    x: NormalizedNumberSchema,
    y: NormalizedNumberSchema,
    width: PositiveNormalizedNumberSchema,
    height: PositiveNormalizedNumberSchema,
  }),
  v.check(
    (anchor) => anchor.x + anchor.width <= 1 && anchor.y + anchor.height <= 1,
    "Selection rectangle extends beyond its target",
  ),
);

export const SelectionAnchorSchema = v.variant("kind", [PointAnchorSchema, RectAnchorSchema]);

const DomHintBoundsSchema = v.pipe(
  v.object({
    x: NormalizedNumberSchema,
    y: NormalizedNumberSchema,
    width: NormalizedNumberSchema,
    height: NormalizedNumberSchema,
  }),
  v.check(
    (bounds) => bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1,
    "DOM hint bounds extend beyond their target",
  ),
);

const DomHintSchema = v.object({
  tag: v.pipe(NonEmptyStringSchema, v.maxLength(240)),
  role: v.optional(DomFieldSchema),
  ariaLabel: v.optional(DomFieldSchema),
  title: v.optional(DomFieldSchema),
  text: v.optional(DomFieldSchema),
  path: v.optional(DomFieldSchema),
  bounds: v.optional(DomHintBoundsSchema),
});

const TargetCellIdsSchema = v.pipe(
  v.array(BoundedIdentifierSchema),
  v.maxLength(64),
  v.check((cellIds) => new Set(cellIds).size === cellIds.length, "Target cell ids must be unique"),
  v.transform((cellIds) => [...cellIds].sort()),
);

const NotebookSelectionTargetSchema = v.pipe(
  v.object({
    kind: v.literal("notebook"),
    cellIds: TargetCellIdsSchema,
    documentId: BoundedIdentifierSchema,
    documentPath: DomSelectorSchema,
  }),
  v.check((target) => target.cellIds.length === 1, "Notebook targets require one cell id"),
);

const NotebookSourceSchema = v.strictObject({
  cellId: BoundedIdentifierSchema,
  selector: v.nullable(v.pipe(NonEmptyStringSchema, v.maxLength(4_096))),
});

const NotebookSourcesSchema = v.pipe(v.array(NotebookSourceSchema), v.maxLength(64));

export type NotebookSource = v.InferOutput<typeof NotebookSourceSchema>;

const DomSelectionTargetSchema = v.pipe(
  v.object({
    kind: v.literal("dom"),
    cellIds: TargetCellIdsSchema,
    sources: NotebookSourcesSchema,
    documentId: BoundedIdentifierSchema,
    documentPath: DomSelectorSchema,
    domSelector: DomSelectorSchema,
  }),
  v.check(
    (target) => target.sources.every((source) => target.cellIds.includes(source.cellId)),
    "Notebook sources must belong to the target cells",
  ),
);

export const SelectionTargetSchema = v.variant("kind", [
  NotebookSelectionTargetSchema,
  DomSelectionTargetSchema,
]);

const TargetSelectorSchema = v.nullable(DomSelectorSchema);

export const AvailableSnapshotSchema = v.object({
  status: v.literal("available"),
  id: SelectionImageIdSchema,
  ...StoredImageEntries,
});

export const OutdatedSnapshotSchema = v.object({
  status: v.literal("outdated"),
  id: SelectionImageIdSchema,
  ...StoredImageEntries,
});

const PendingSnapshotSchema = v.object({
  status: v.literal("pending"),
});

const FailedSnapshotSchema = v.object({
  status: v.literal("failed"),
  capturedAt: TimestampSchema,
  error: v.optional(v.pipe(UnicodeStringSchema, v.maxLength(500))),
});

const SelectionSnapshotSchema = v.variant("status", [
  PendingSnapshotSchema,
  AvailableSnapshotSchema,
  OutdatedSnapshotSchema,
  FailedSnapshotSchema,
]);

const RenderSourceSchema = v.strictObject({
  path: v.pipe(NonEmptyStringSchema, v.maxLength(1_024)),
  line: v.optional(PositiveIntegerSchema),
  column: v.optional(PositiveIntegerSchema),
  symbol: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(256))),
});

/** The file a target shows part of, with an optional page and an optional time span whose end follows its start. */
const TargetMediaSchema = v.pipe(
  v.strictObject({
    path: v.pipe(NonEmptyStringSchema, v.maxLength(1_024)),
    page: v.optional(PositiveIntegerSchema),
    start: v.optional(SecondsSchema),
    end: v.optional(SecondsSchema),
  }),
  v.check(
    (media) => media.start === undefined || media.end === undefined || media.end > media.start,
    "Media end must come after its start",
  ),
);

export const TargetInfoSchema = v.strictObject({
  label: v.pipe(NonEmptyStringSchema, v.maxLength(256)),
  detail: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(512))),
  renderSource: v.optional(RenderSourceSchema),
  media: v.optional(TargetMediaSchema),
});

export type TargetInfo = v.InferOutput<typeof TargetInfoSchema>;
export type RenderSource = v.InferOutput<typeof RenderSourceSchema>;
export type TargetMedia = v.InferOutput<typeof TargetMediaSchema>;

export function parseRenderSource(value: TransportValue): RenderSource {
  return parseContract(RenderSourceSchema, value, "Lens render source");
}

export function parseTargetMedia(value: TransportValue): TargetMedia {
  return parseContract(TargetMediaSchema, value, "Lens target media");
}

const SelectionInputObjectSchema = v.object({
  id: BoundedIdentifierSchema,
  label: SelectionLabelSchema,
  note: v.pipe(UnicodeStringSchema, v.maxLength(4_000)),
  target: SelectionTargetSchema,
  createdAt: TimestampSchema,
  anchor: SelectionAnchorSchema,
  domHint: v.optional(DomHintSchema),
  description: TargetInfoSchema,
  snapshot: SelectionSnapshotSchema,
});

const PreviousResolutionSchema = v.object({
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

export type PointAnchor = v.InferOutput<typeof PointAnchorSchema>;
export type RectAnchor = v.InferOutput<typeof RectAnchorSchema>;
export type SelectionAnchor = v.InferOutput<typeof SelectionAnchorSchema>;
export type DomHint = v.InferOutput<typeof DomHintSchema>;
export type DomHintBounds = v.InferOutput<typeof DomHintBoundsSchema>;
export type NotebookSelectionTarget = v.InferOutput<typeof NotebookSelectionTargetSchema>;
export type DomSelectionTarget = v.InferOutput<typeof DomSelectionTargetSchema>;
export type SelectionTarget = v.InferOutput<typeof SelectionTargetSchema>;
export type TargetSelector = v.InferOutput<typeof TargetSelectorSchema>;
export type AvailableSnapshot = v.InferOutput<typeof AvailableSnapshotSchema>;
export type OutdatedSnapshot = v.InferOutput<typeof OutdatedSnapshotSchema>;
export type PendingSnapshot = v.InferOutput<typeof PendingSnapshotSchema>;
export type SelectionSnapshot = v.InferOutput<typeof SelectionSnapshotSchema>;
export type PreviousResolution = v.InferOutput<typeof PreviousResolutionSchema>;
export type SelectionInput = v.InferOutput<typeof SelectionInputSchema>;
export type Selection = v.InferOutput<typeof SelectionSchema>;

export function parseSelectionTarget(
  input: v.InferInput<typeof SelectionTargetSchema> | TransportValue,
): SelectionTarget {
  return parseContract(SelectionTargetSchema, input, "Lens selection target");
}

export function parseTargetSelector(
  input: v.InferInput<typeof TargetSelectorSchema> | TransportValue,
): TargetSelector {
  return parseContract(TargetSelectorSchema, input, "Lens target selector");
}

const AddressedSelectionSchema = v.object({
  selectionId: BoundedIdentifierSchema,
  label: SelectionLabelSchema,
  note: v.pipe(UnicodeStringSchema, v.maxLength(4_000)),
  target: SelectionTargetSchema,
  createdAt: TimestampSchema,
  addressedAt: TimestampSchema,
  anchor: SelectionAnchorSchema,
  domHint: v.optional(DomHintSchema),
  description: TargetInfoSchema,
  summary: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(240))),
  resolutionRevision: RevisionSchema,
});

export type AddressedSelection = v.InferOutput<typeof AddressedSelectionSchema>;

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

export type LensState = v.InferOutput<typeof LensStateSchema>;

export function parseLensState(
  input: v.InferInput<typeof LensStateSchema> | TransportValue,
): LensState {
  return parseContract(LensStateSchema, input, "Lens state");
}
