import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type DocumentCreateProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly url?: unknown
  readonly checksum?: unknown
  readonly resModel?: unknown
  readonly res_model?: unknown
  readonly resId?: unknown
  readonly res_id?: unknown
}

function optional(value: unknown): unknown {
  return value != null && typeof value === "object" && "some" in value ? (value as { some: unknown }).some : value
}

/**
 * Resolve the document `create_document` made (the reducer returns nothing): a row that did not
 * exist before dispatch, in the organization, with the uploaded blob's url + checksum and the
 * host record's model/id. Two matches are ambiguous and throw; none returns null.
 */
export function resolveDocumentCreateEffect(
  before: readonly DocumentCreateProjection[],
  after: readonly DocumentCreateProjection[],
  organizationId: bigint,
  expected: { readonly url: string; readonly checksum: string; readonly resModel?: string; readonly resId?: bigint },
): CanonicalRecordRef | null {
  const known = new Set(before.map((row) => parseStrictU64(row.id)?.toString()))
  const created = after.filter((row) => {
    const id = parseStrictU64(row.id)
    if (id == null || known.has(id.toString())) return false
    if (parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return false
    if (optional(row.url) !== expected.url) return false
    if (String(optional(row.checksum) ?? "").toLowerCase() !== expected.checksum.trim().toLowerCase()) return false
    if (expected.resModel !== undefined && optional(row.resModel ?? row.res_model) !== expected.resModel) return false
    if (expected.resId !== undefined && parseStrictU64(optional(row.resId ?? row.res_id)) !== expected.resId) return false
    return true
  })
  if (created.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one new document, found ${created.length}`)
  }
  const id = created[0] ? parseStrictU64(created[0].id) : null
  return id == null ? null : { resource: "documents", id: id.toString() }
}
