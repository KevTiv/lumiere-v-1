import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type DocumentVersionProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly documentId?: unknown
  readonly document_id?: unknown
  readonly url?: unknown
  readonly checksum?: unknown
  readonly isCurrent?: unknown
  readonly is_current?: unknown
}

/**
 * COV-18: resolve the version row this check-in created. It is a row that did
 * not exist before dispatch, belongs to the exact document + organization,
 * carries the uploaded blob's url + checksum and is the current version.
 */
export function resolveDocumentVersionEffect(
  before: readonly DocumentVersionProjection[],
  after: readonly DocumentVersionProjection[],
  organizationId: bigint,
  documentId: bigint,
  blob: { readonly url: string; readonly checksum: string },
): CanonicalRecordRef | null {
  const known = new Set(before.map((row) => parseStrictU64(row.id)?.toString()))
  const created = after.filter((row) => {
    const id = parseStrictU64(row.id)
    return (
      id != null &&
      !known.has(id.toString()) &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      parseStrictU64(row.documentId ?? row.document_id) === documentId &&
      row.url === blob.url &&
      String(row.checksum ?? "").toLowerCase() === blob.checksum.trim().toLowerCase() &&
      (row.isCurrent ?? row.is_current) === true
    )
  })
  if (created.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one new document version, found ${created.length}`)
  }
  const id = created[0] ? parseStrictU64(created[0].id) : null
  return id == null ? null : { resource: "document-versions", id: id.toString() }
}
