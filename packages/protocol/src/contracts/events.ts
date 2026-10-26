import * as v from "valibot";

import type { TransportEnvelope, TransportValue } from "./transport";

import {
  AttentionDurationSchema,
  AttentionLabelSchema,
  BoundedIdentifierSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  SelectionLabelSchema,
  SummarySchema,
  WIDGET_TRANSPORT_VERSION,
  parseContract,
} from "./transport";

export const MAX_RESOLVED_SELECTIONS = 64;

const EventBaseSchema = {
  protocol: v.literal("marimo-lens.event"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
} as const;

const ResolvedSelectionSchema = v.object({
  selectionId: BoundedIdentifierSchema,
  label: SelectionLabelSchema,
  resolutionRevision: RevisionSchema,
});

export const SelectionResolvedEventSchema = v.object({
  ...EventBaseSchema,
  type: v.literal("selection.resolved"),
  revision: RevisionSchema,
  payload: v.object({
    selections: v.pipe(
      v.array(ResolvedSelectionSchema),
      v.minLength(1),
      v.maxLength(MAX_RESOLVED_SELECTIONS),
      v.check(
        (selections) =>
          new Set(selections.map((selection) => selection.selectionId)).size === selections.length,
        "Resolved selections must be unique",
      ),
    ),
    summary: v.optional(SummarySchema),
  }),
});

const AttentionTrailStopEventSchema = v.object({
  ...EventBaseSchema,
  type: v.literal("attention.trail.stop"),
  payload: v.object({ trailId: BoundedIdentifierSchema }),
});

const CellAttentionAddressSchema = v.object({
  kind: v.literal("cell"),
  cellId: BoundedIdentifierSchema,
});

const SelectionAttentionAddressSchema = v.object({
  kind: v.literal("selection"),
  selectionId: BoundedIdentifierSchema,
  revision: RevisionSchema,
});

const AttentionAddressSchema = v.variant("kind", [
  CellAttentionAddressSchema,
  SelectionAttentionAddressSchema,
]);

const TrailStepSchema = v.object({
  address: AttentionAddressSchema,
  label: v.optional(AttentionLabelSchema),
  message: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(1_000))),
});

const TrailSchema = v.object({
  id: BoundedIdentifierSchema,
  steps: v.pipe(v.array(TrailStepSchema), v.minLength(1), v.maxLength(16)),
  durationMs: v.optional(AttentionDurationSchema),
});

export const AttentionRevealEventSchema = v.object({
  ...EventBaseSchema,
  type: v.literal("attention.reveal"),
  payload: TrailSchema,
});

export const AttentionActivityStartEventSchema = v.object({
  ...EventBaseSchema,
  type: v.literal("attention.activity.start"),
  payload: v.object({
    activityId: BoundedIdentifierSchema,
    address: AttentionAddressSchema,
    durationMs: v.optional(AttentionDurationSchema),
    label: v.optional(AttentionLabelSchema),
    message: v.optional(v.pipe(NonEmptyStringSchema, v.maxLength(240))),
  }),
});

export const AttentionActivityStopEventSchema = v.object({
  ...EventBaseSchema,
  type: v.literal("attention.activity.stop"),
  payload: v.object({ activityId: BoundedIdentifierSchema }),
});

const AttentionEventSchema = v.variant("type", [
  AttentionActivityStartEventSchema,
  AttentionActivityStopEventSchema,
  AttentionRevealEventSchema,
  AttentionTrailStopEventSchema,
]);

export type CellAttentionAddress = v.InferOutput<typeof CellAttentionAddressSchema>;
export type SelectionAttentionAddress = v.InferOutput<typeof SelectionAttentionAddressSchema>;
export type AttentionAddress = v.InferOutput<typeof AttentionAddressSchema>;
export type ResolvedSelection = v.InferOutput<typeof ResolvedSelectionSchema>;
export type SelectionResolvedEvent = v.InferOutput<typeof SelectionResolvedEventSchema>;
export type AttentionRevealEvent = v.InferOutput<typeof AttentionRevealEventSchema>;
export type Trail = v.InferOutput<typeof TrailSchema>;
export type TrailStep = v.InferOutput<typeof TrailStepSchema>;
export type AttentionActivityStartEvent = v.InferOutput<typeof AttentionActivityStartEventSchema>;
export type AttentionActivityStopEvent = v.InferOutput<typeof AttentionActivityStopEventSchema>;
export type AttentionEvent = v.InferOutput<typeof AttentionEventSchema>;

export function parseSelectionResolvedEvent(
  input: v.InferInput<typeof SelectionResolvedEventSchema> | TransportEnvelope | TransportValue,
): SelectionResolvedEvent {
  return parseContract(SelectionResolvedEventSchema, input, "Lens resolution event");
}

export function parseAttentionEvent(
  input: v.InferInput<typeof AttentionEventSchema> | TransportEnvelope | TransportValue,
): AttentionEvent {
  return parseContract(AttentionEventSchema, input, "Lens attention event");
}
