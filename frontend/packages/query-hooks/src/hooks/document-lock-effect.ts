import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type DocumentLockProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly isLocked?: unknown
  readonly is_locked?: unknown
  readonly lockedBy?: unknown
  readonly locked_by?: unknown
}

export type DocumentLockExpectation = "locked" | "unlocked"

function exactDocument(
  rows: readonly DocumentLockProjection[],
  organizationId: bigint,
  documentId: bigint,
): DocumentLockProjection | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === documentId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one document, found ${matches.length}`)
  }
  const row = matches[0]
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  return row
}

/**
 * COV-18: resolve the exact document that reads back in the expected lock
 * state. Lock additionally requires a recorded holder; unlock requires none.
 */
export function resolveDocumentLockEffect(
  rows: readonly DocumentLockProjection[],
  organizationId: bigint,
  documentId: bigint,
  expected: DocumentLockExpectation,
): CanonicalRecordRef | null {
  const row = exactDocument(rows, organizationId, documentId)
  if (!row) return null
  const isLocked = (row.isLocked ?? row.is_locked) === true
  const holder = row.lockedBy ?? row.locked_by ?? null
  if (expected === "locked" ? !isLocked || holder == null : isLocked || holder != null) return null
  return { resource: "documents", id: documentId.toString() }
}
