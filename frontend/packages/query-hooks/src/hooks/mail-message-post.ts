import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type MailMessageProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly model?: unknown
  readonly resId?: unknown
  readonly res_id?: unknown
  readonly body?: unknown
}

export type PostedMessageExpectation = {
  readonly organizationId: bigint
  readonly model: string
  readonly resId: bigint
  readonly body: string
}

/**
 * COV-19: `post_message` takes no client request id and the `mail-messages` projection
 * carries no author, so a post is read back as the difference between the messages
 * read before and after it: exactly one new row for the exact organization, model,
 * record and body. Zero new rows means the post did not land; more than one means a
 * concurrent identical post and is an invariant failure — never "the newest message".
 */
export function resolvePostedMessageEffect(
  before: readonly MailMessageProjection[],
  after: readonly MailMessageProjection[],
  expected: PostedMessageExpectation,
): CanonicalRecordRef | null {
  const known = new Set<bigint>()
  for (const row of before) {
    const id = parseStrictU64(row.id)
    if (id != null) known.add(id)
  }
  const created = after.filter((row) => {
    const id = parseStrictU64(row.id)
    return (
      id != null
      && !known.has(id)
      && parseStrictU64(row.organizationId ?? row.organization_id) === expected.organizationId
      && String(row.model ?? "") === expected.model
      && parseStrictU64(row.resId ?? row.res_id) === expected.resId
      && String(row.body ?? "") === expected.body
    )
  })
  if (created.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one posted message, found ${created.length}`)
  }
  const id = created[0] ? parseStrictU64(created[0].id) : undefined
  return id == null ? null : { resource: "mail-messages", id: id.toString() }
}
