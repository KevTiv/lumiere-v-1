import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type WorkflowVersionEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly status?: unknown
  readonly contentHash?: unknown
  readonly content_hash?: unknown
  readonly publishedDate?: unknown
  readonly published_date?: unknown
  readonly retiredDate?: unknown
  readonly retired_date?: unknown
}

function enumTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0] ?? ""
  }
  return ""
}

/** Resolve one exact sealed workflow-version state; duplicate ids are invariant failures. */
export function resolveWorkflowVersionStateEffect(
  rows: readonly WorkflowVersionEffectProjection[],
  organizationId: bigint,
  workflowVersionId: bigint,
  expectedStatus: "Published" | "Retired",
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === workflowVersionId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one workflow version ${workflowVersionId}, found ${matches.length}`,
    )
  }
  const row = matches[0]
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) {
    return null
  }
  if (enumTag(row.status) !== expectedStatus) return null

  // Publication is not proven by the status tag alone: sealing must retain a
  // canonical definition hash and publication timestamp. Retirement preserves
  // that hash and adds its own terminal timestamp.
  const hash = row.contentHash ?? row.content_hash
  const publishedAt = row.publishedDate ?? row.published_date
  if (typeof hash !== "string" || !hash.startsWith("sha256:") || publishedAt == null) return null
  if (expectedStatus === "Retired" && (row.retiredDate ?? row.retired_date) == null) return null

  return { resource: "workflow-versions", id: workflowVersionId.toString() }
}
