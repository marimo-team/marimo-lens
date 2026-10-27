import * as v from "valibot";

import type { TransportEnvelope, TransportValue } from "./transport";

import { AvailableSnapshotSchema, OutdatedSnapshotSchema, SelectionInputSchema } from "./selection";
import {
  BoundedIdentifierSchema,
  DomSelectorSchema,
  NonEmptyStringSchema,
  OutputCaptureImageIdSchema,
  RequestIdSchema,
  RevisionSchema,
  Sha256Schema,
  StoredImageEntries,
  TimestampSchema,
  UnicodeStringSchema,
  WIDGET_TRANSPORT_VERSION,
  parseContract,
} from "./transport";

export const OutputCaptureImageSchema = v.object({
  status: v.literal("available"),
  id: OutputCaptureImageIdSchema,
  ...StoredImageEntries,
});

const ImageActionSchema = v.picklist(["preserve", "replace", "clear"]);

const StoredSnapshotSchema = v.variant("status", [AvailableSnapshotSchema, OutdatedSnapshotSchema]);

export const SnapshotResponsePayloadSchema = v.object({
  selectionId: BoundedIdentifierSchema,
  snapshot: StoredSnapshotSchema,
});

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

const ClearSelectionsCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("selections.clear"),
  payload: v.object({
    expectedRevision: RevisionSchema,
  }),
});

const ReopenSelectionCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("selection.reopen"),
  payload: v.object({
    selectionId: BoundedIdentifierSchema,
    resolvedAt: TimestampSchema,
    documentId: BoundedIdentifierSchema,
    documentPath: DomSelectorSchema,
    expectedRevision: RevisionSchema,
  }),
});

const RefreshHistoryCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("history.refresh"),
  payload: v.object({}),
});

export const GetSnapshotCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("snapshot.get"),
  payload: v.object({
    selectionId: BoundedIdentifierSchema,
  }),
});

const GetHistoryImageCommandSchema = v.object({
  ...CommandBaseSchema,
  type: v.literal("history.image"),
  payload: v.object({
    sha256: Sha256Schema,
  }),
});

const OutputCaptureCommandSchema = v.object({
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
  RefreshHistoryCommandSchema,
  GetSnapshotCommandSchema,
  GetHistoryImageCommandSchema,
]);

export const OutputCaptureResponsePayloadSchema = v.object({
  outputCellId: BoundedIdentifierSchema,
  image: OutputCaptureImageSchema,
});

const ResponseBaseSchema = {
  protocol: v.literal("marimo-lens.response"),
  version: v.literal(WIDGET_TRANSPORT_VERSION),
  requestId: RequestIdSchema,
  revision: RevisionSchema,
  payload: v.record(UnicodeStringSchema, v.unknown()),
} as const;

const SuccessfulResponseSchema = v.object({
  ...ResponseBaseSchema,
  ok: v.literal(true),
});

const FailedResponseSchema = v.object({
  ...ResponseBaseSchema,
  ok: v.literal(false),
  error: v.object({
    code: v.pipe(NonEmptyStringSchema, v.maxLength(128)),
    message: v.pipe(NonEmptyStringSchema, v.maxLength(500)),
  }),
});

const LensResponseSchema = v.variant("ok", [SuccessfulResponseSchema, FailedResponseSchema]);

export type OutputCaptureImage = v.InferOutput<typeof OutputCaptureImageSchema>;
export type ImageAction = v.InferOutput<typeof ImageActionSchema>;
export type StoredSnapshot = v.InferOutput<typeof StoredSnapshotSchema>;
export type SnapshotResponsePayload = v.InferOutput<typeof SnapshotResponsePayloadSchema>;
export type ClientCommand = v.InferOutput<typeof ClientCommandSchema>;
export type OutputCaptureCommand = v.InferOutput<typeof OutputCaptureCommandSchema>;
export type OutputCaptureResponsePayload = v.InferOutput<typeof OutputCaptureResponsePayloadSchema>;
export type LensResponse = v.InferOutput<typeof LensResponseSchema>;
export type CommandType = ClientCommand["type"];

export type CommandPayload<TType extends CommandType> = Extract<
  ClientCommand,
  { type: TType }
>["payload"];

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
