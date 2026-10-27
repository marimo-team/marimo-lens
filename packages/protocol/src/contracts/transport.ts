import * as v from "valibot";

import { hasTextContent } from "../bounded-text";

export const WIDGET_TRANSPORT_VERSION = 7;

export type TransportPrimitive = boolean | null | number | string | undefined;
export type TransportRecord = { readonly [key: string]: TransportValue };
export type TransportValue = TransportPrimitive | readonly TransportValue[] | TransportRecord;

const TransportDiscriminatorSchema = v.union([v.boolean(), v.null(), v.number(), v.string()]);

const TransportEnvelopeSchema = v.looseObject({
  protocol: v.optional(TransportDiscriminatorSchema),
  requestId: v.optional(v.string()),
  type: v.optional(TransportDiscriminatorSchema),
});

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export const UnicodeStringSchema = v.pipe(
  v.string(),
  v.check(isValidUnicodeText, "String must contain valid Unicode text"),
);

export const NonEmptyStringSchema = v.pipe(
  UnicodeStringSchema,
  v.check(hasTextContent, "String must not be blank"),
);

export const BoundedIdentifierSchema = v.pipe(NonEmptyStringSchema, v.maxLength(128));

export const RequestIdSchema = v.pipe(NonEmptyStringSchema, v.maxLength(256));

export const TimestampSchema = v.pipe(
  UnicodeStringSchema,
  v.nonEmpty(),
  v.maxLength(64),
  v.regex(TIMESTAMP_PATTERN),
  v.check(hasValidTimestamp, "Timestamp must identify a valid calendar date and time"),
);

export const DomFieldSchema = v.pipe(UnicodeStringSchema, v.maxLength(240));

export const DomSelectorSchema = v.pipe(NonEmptyStringSchema, v.maxLength(1_024));

export const SelectionImageIdSchema = v.pipe(NonEmptyStringSchema, v.maxLength(134));

export const OutputCaptureImageIdSchema = v.pipe(NonEmptyStringSchema, v.maxLength(262));

const FiniteNumberSchema = v.pipe(v.number(), v.finite());

export const NormalizedNumberSchema = v.pipe(FiniteNumberSchema, v.minValue(0), v.maxValue(1));

export const PositiveNormalizedNumberSchema = v.pipe(
  FiniteNumberSchema,
  v.check((value) => value > 0, "Number must be positive"),
  v.maxValue(1),
);

export const PositiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

export const Sha256Schema = v.pipe(v.string(), v.regex(/^[a-f\d]{64}$/));

export const RevisionSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

export const AttentionDurationSchema = v.pipe(PositiveIntegerSchema, v.maxValue(300_000));

export const SummarySchema = v.pipe(NonEmptyStringSchema, v.maxLength(240));

export const SelectionLabelSchema = v.pipe(
  UnicodeStringSchema,
  v.maxLength(16),
  v.regex(/^S[1-9]\d*$/),
);

/** The fields every stored PNG carries, whatever identifies it. */
export const StoredImageEntries = {
  mediaType: v.literal("image/png"),
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: Sha256Schema,
  capturedAt: TimestampSchema,
} as const;

export const AttentionLabelSchema = v.pipe(NonEmptyStringSchema, v.maxLength(40));

export const SecondsSchema = v.pipe(FiniteNumberSchema, v.minValue(0));

export type TransportEnvelope = v.InferOutput<typeof TransportEnvelopeSchema>;

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

export function parseTransportEnvelope(input: TransportValue): TransportEnvelope | null {
  const result = v.safeParse(TransportEnvelopeSchema, input);
  return result.success ? result.output : null;
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
