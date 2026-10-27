import * as v from "valibot";

import type { TransportValue } from "./transport";

import { SelectionAnchorSchema, SelectionTargetSchema, TargetInfoSchema } from "./selection";
import {
  BoundedIdentifierSchema,
  PositiveIntegerSchema,
  RevisionSchema,
  SelectionLabelSchema,
  Sha256Schema,
  SummarySchema,
  TimestampSchema,
  UnicodeStringSchema,
  parseContract,
} from "./transport";

const CellNameSchema = v.pipe(UnicodeStringSchema, v.maxLength(256));

const HistoryChangeSchema = v.object({
  cellId: v.optional(BoundedIdentifierSchema),
  name: v.optional(CellNameSchema),
  status: v.picklist(["in_force", "undone", "unknown"]),
  undoneBy: v.optional(BoundedIdentifierSchema),
  /** Statements the change added that its cell no longer holds. */
  missing: v.optional(
    v.pipe(v.array(v.pipe(UnicodeStringSchema, v.maxLength(240))), v.minLength(1), v.maxLength(8)),
  ),
});

/** How History names one cell of the notebook now. */
const HistoryCellSchema = v.object({
  id: BoundedIdentifierSchema,
  name: v.optional(CellNameSchema),
  defines: v.pipe(v.array(CellNameSchema), v.maxLength(8)),
});

const HistoryImageSchema = v.object({
  sha256: Sha256Schema,
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  capturedAt: TimestampSchema,
  outdated: v.boolean(),
});

const HistoryEntrySchema = v.object({
  id: BoundedIdentifierSchema,
  channel: v.picklist(["selection", "chat"]),
  label: v.optional(SelectionLabelSchema),
  note: v.pipe(UnicodeStringSchema, v.maxLength(500)),
  summary: v.optional(SummarySchema),
  openedAt: TimestampSchema,
  resolvedAt: TimestampSchema,
  revision: RevisionSchema,
  cellIds: v.pipe(v.array(BoundedIdentifierSchema), v.maxLength(64)),
  changes: v.pipe(v.array(HistoryChangeSchema), v.maxLength(64)),
  selection: v.optional(
    v.object({
      target: SelectionTargetSchema,
      anchor: SelectionAnchorSchema,
      description: TargetInfoSchema,
    }),
  ),
  image: v.optional(HistoryImageSchema),
  /** Open selections whose cells or upstream the request changed or traced. */
  shaped: v.optional(v.pipe(v.array(BoundedIdentifierSchema), v.minLength(1), v.maxLength(64))),
});

export const HistoryStateSchema = v.object({
  entries: v.pipe(v.array(HistoryEntrySchema), v.maxLength(100)),
  total: RevisionSchema,
  record: v.object({
    status: v.picklist(["saved", "unsaved", "session", "failed"]),
    reason: v.optional(v.pipe(UnicodeStringSchema, v.maxLength(500))),
  }),
  cells: v.pipe(v.array(HistoryCellSchema), v.maxLength(256)),
});

export const HistoryImageResponsePayloadSchema = v.object({
  sha256: Sha256Schema,
});

export type HistoryChange = v.InferOutput<typeof HistoryChangeSchema>;
export type HistoryCell = v.InferOutput<typeof HistoryCellSchema>;
export type HistoryImage = v.InferOutput<typeof HistoryImageSchema>;
export type HistoryEntry = v.InferOutput<typeof HistoryEntrySchema>;
export type HistoryState = v.InferOutput<typeof HistoryStateSchema>;
export type HistoryImageResponsePayload = v.InferOutput<typeof HistoryImageResponsePayloadSchema>;

/** Parse the `_history` trait, which is null while the Lens shows no History. */
export function parseHistoryTrait(
  input: v.InferInput<typeof HistoryStateSchema> | TransportValue,
): HistoryState | null {
  return parseContract(v.nullable(HistoryStateSchema), input, "Lens history");
}

/** A chat request an agent opened, quoting the analyst. */
const ChatRequestSchema = v.object({
  id: BoundedIdentifierSchema,
  note: v.pipe(UnicodeStringSchema, v.maxLength(500)),
  openedAt: TimestampSchema,
});

/** The runtime's open chat requests, oldest first. */
export const ChatsSchema = v.pipe(v.array(ChatRequestSchema), v.maxLength(16));

export type ChatRequest = v.InferOutput<typeof ChatRequestSchema>;

/** Parse the `_chats` trait: the runtime's open chat requests. */
export function parseChatsTrait(
  input: v.InferInput<typeof ChatsSchema> | TransportValue,
): ChatRequest[] {
  return parseContract(ChatsSchema, input, "Lens chats");
}
