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
    if ("tag" in status && typeof status.tag === "string") return status.tag.toLowerCase()
    const keys = Object.keys(status)
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

export type SaleOrderScopeProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
}

/**
 * COV-17: resolve the sale order created by `convert_proposal_to_sale_order`
 * through the proposal's own `sale_order_id` relation — never by newest order.
 * The proposal must be the same Awarded id in scope, and exactly one sale order
 * with that id must exist in the same organization and company.
 */
export function resolveProposalConversionEffect(
  proposalRows: readonly (ProposalStatusProjection & { readonly saleOrderId?: unknown; readonly sale_order_id?: unknown })[],
  saleOrderRows: readonly SaleOrderScopeProjection[],
  organizationId: bigint,
  companyId: bigint,
  proposalId: bigint,
): CanonicalRecordRef | null {
  if (!resolveProposalStatusEffect(proposalRows, organizationId, companyId, proposalId, "awarded")) return null
  const proposal = proposalRows.find((row) => parseStrictU64(row.id) === proposalId)!
  const saleOrderId = parseStrictU64(proposal.saleOrderId ?? proposal.sale_order_id)
  if (saleOrderId == null) return null
  const orders = saleOrderRows.filter((row) => parseStrictU64(row.id) === saleOrderId)
  if (orders.length > 1) throw new AmbiguousOperationEffectError(`Expected one sale order, found ${orders.length}`)
  const order = orders[0]
  if (!order
    || parseStrictU64(order.organizationId ?? order.organization_id) !== organizationId
    || parseStrictU64(order.companyId ?? order.company_id) !== companyId) return null
  return { resource: "sale-orders", id: saleOrderId.toString() }
}
