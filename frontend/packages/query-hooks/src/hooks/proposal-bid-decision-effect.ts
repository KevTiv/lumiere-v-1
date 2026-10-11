import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import {
  AmbiguousOperationEffectError,
  type CanonicalRecordRef,
} from "./operation-effect"
import { enumState } from "./exact-record-state"

export type ProposalBidDecisionProjection = {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  proposalId?: unknown
  proposal_id?: unknown
  decision?: unknown
  rationale?: unknown
}

export function proposalBidDecisionIds(
  rows: readonly ProposalBidDecisionProjection[],
): ReadonlySet<bigint> {
  return new Set(
    rows
      .map((row) => parseStrictU64(row.id))
      .filter((id): id is bigint => id != null),
  )
}

/** Resolve the one new decision row created for this exact proposal and payload. */
export function resolveProposalBidDecisionEffect(
  rows: readonly ProposalBidDecisionProjection[],
  beforeIds: ReadonlySet<bigint>,
  organizationId: bigint,
  companyId: bigint,
  proposalId: bigint,
  decision: string,
  rationale: string,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => {
    const id = parseStrictU64(row.id)
    return (
      id != null &&
      !beforeIds.has(id) &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      parseStrictU64(row.proposalId ?? row.proposal_id) === proposalId &&
      enumState(row.decision) === decision.toLowerCase() &&
      String(row.rationale ?? "") === rationale
    )
  })
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one new proposal bid decision, found ${matches.length}`,
    )
  }
  const id = parseStrictU64(matches[0]?.id)
  return id == null
    ? null
    : {
        resource: "proposal-bid-decisions",
        id: id.toString(),
        href: `/proposals/${proposalId}`,
      }
}
