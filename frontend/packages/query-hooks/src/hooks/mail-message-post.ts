import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type MailMessagePostProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly model?: unknown
  readonly resId?: unknown
  readonly res_id?: unknown
  readonly metadata?: unknown
}

export type PostedMessageExpectation = {
  readonly idempotencyKey: string
  readonly model: string
  readonly resId: bigint
}

/** The idempotency key `post_message` stored in a row's `metadata` JSON, if any. */
function storedIdempotencyKey(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    const key = (parsed as { idempotency_key?: unknown } | null)?.idempotency_key
    return typeof key === "string" ? key : null
  } catch {
    return null
  }
}

/**
 * COV-19: resolve the exact message a keyed `post_message` created. The key names the
 * submission, so the row is found by identity rather than by newest row or matching body.
 */
export function resolvePostedMessageEffect(
  rows: readonly MailMessagePostProjection[],
  organizationId: bigint,
  expected: PostedMessageExpectation,
): CanonicalRecordRef | null {
  const matches = rows.filter(
    (row) =>
      storedIdempotencyKey(row.metadata) === expected.idempotencyKey &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      row.model === expected.model &&
      parseStrictU64(row.resId ?? row.res_id) === expected.resId,
  )
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one posted message, found ${matches.length}`)
  const row = matches[0]
  if (!row) return null
  const id = parseStrictU64(row.id)
  return id == null ? null : { resource: "mail-messages", id: id.toString() }
}
