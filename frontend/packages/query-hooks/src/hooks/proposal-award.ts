import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type ProposalStatusProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly status?: unknown
}

/** Normalise a SATS enum or string status (`"Awarded"`, `{ tag: "Awarded" }`, `"awarded"`). */
export function proposalStatusKey(status: unknown): string {
  if (typeof status === "string") return status.trim().toLowerCase()
  if (status && typeof status === "object" && !Array.isArray(status)) {
    const record = status as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag.toLowerCase()
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

/**
 * COV-17: resolve the same proposal id, in the same organization and company,
 * in the requested status after `update_proposal_status`.
 */
export function resolveProposalStatusEffect(
  rows: readonly ProposalStatusProjection[],
  organizationId: bigint,
  companyId: bigint,
  proposalId: bigint,
  expectedStatus: string,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === proposalId)
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one proposal, found ${matches.length}`)
  const row = matches[0]
  if (!row
    || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId
    || parseStrictU64(row.companyId ?? row.company_id) !== companyId
    || proposalStatusKey(row.status) !== proposalStatusKey(expectedStatus)) return null
  return { resource: "proposals", id: proposalId.toString() }
}
