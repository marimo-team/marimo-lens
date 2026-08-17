import * as v from "valibot";

const ErrorCauseSchema = v.object({
  name: v.optional(v.string()),
  message: v.optional(v.string()),
});

export type ErrorCause = v.InferOutput<typeof ErrorCauseSchema>;

export function parseErrorCause(cause: unknown): ErrorCause | null {
  const result = v.safeParse(ErrorCauseSchema, cause);
  return result.success ? result.output : null;
}

export function isAbortCause(cause: unknown): boolean {
  return parseErrorCause(cause)?.name === "AbortError";
}
