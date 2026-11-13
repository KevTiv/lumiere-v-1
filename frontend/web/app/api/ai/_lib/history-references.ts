import { z } from "zod"

const u64 = z
  .string()
  .refine(
    (value) =>
      /^[1-9][0-9]{0,19}$/.test(value) &&
      BigInt(value) <= 18_446_744_073_709_551_615n,
  )
const sessionKey = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/)
const receiptId = z.string().regex(/^[a-f0-9]{32}$/)
const revision = z.number().int().min(1).max(2_147_483_647)

export const MAX_ASSISTANT_HISTORY_REFERENCES = 4

export const assistantHistoryReference = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), sessionKey, messageId: u64 }).strict(),
  z
    .object({
      kind: z.literal("decision"),
      sessionKey,
      messageId: u64,
      decisionId: receiptId,
      revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("import_decision"),
      sessionKey,
      taskId: receiptId,
      decisionId: receiptId,
      revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("import_mapping"),
      sessionKey,
      taskId: receiptId,
      batchId: u64,
      itemId: u64,
      revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("approval_receipt"),
      taskId: u64,
      eventId: u64,
      revision: u64,
      idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/),
      inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      actingFor: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      workScope: z.enum([
        "purchasing",
        "sales",
        "accounting",
        "expenses",
        "finance",
      ]),
    })
    .strict(),
])

export type AssistantHistoryReference = z.infer<
  typeof assistantHistoryReference
>

export function parseHistoryReferences(
  raw: unknown,
): AssistantHistoryReference[] | undefined {
  if (raw === undefined) return undefined
  const parsed = z
    .array(assistantHistoryReference)
    .max(MAX_ASSISTANT_HISTORY_REFERENCES)
    .safeParse(raw)
  if (!parsed.success)
    throw new Error("Choose up to four valid saved chat references.")
  const unique = new Map(
    parsed.data.map((reference) => [JSON.stringify(reference), reference]),
  )
  return unique.size > 0 ? Array.from(unique.values()) : undefined
}
