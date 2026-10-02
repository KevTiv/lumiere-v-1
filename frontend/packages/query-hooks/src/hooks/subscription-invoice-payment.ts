import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type InvoicePaymentProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly paymentState?: unknown
  readonly payment_state?: unknown
  readonly amountResidual?: unknown
  readonly amount_residual?: unknown
}

/** Money epsilon: residuals are stored as f64. */
const EPSILON = 0.0001

/** Normalise a SATS enum cell (`"Paid"`, `{ tag: "Paid" }`, `{ paid: [] }`). */
export function paymentStateTag(state: unknown): string {
  if (typeof state === "string") return state
  if (state && typeof state === "object" && !Array.isArray(state)) {
    if ("tag" in state && typeof state.tag === "string") return state.tag
    const keys = Object.keys(state)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return ""
}

function exactInvoice(
  moves: readonly InvoicePaymentProjection[],
  organizationId: bigint,
  companyId: bigint,
  invoiceMoveId: bigint,
): InvoicePaymentProjection | null {
  const matches = moves.filter((move) => parseStrictU64(move.id) === invoiceMoveId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one invoice move, found ${matches.length}`)
  }
  const move = matches[0]
  if (
    !move
    || parseStrictU64(move.organizationId ?? move.organization_id) !== organizationId
    || parseStrictU64(move.companyId ?? move.company_id) !== companyId
  ) return null
  return move
}

function residualOf(move: InvoicePaymentProjection): number | null {
  const raw = move.amountResidual ?? move.amount_residual
  if (raw == null || raw === "") return null
  const residual = Number(raw)
  return Number.isFinite(residual) ? residual : null
}

/** The invoice's open residual for the exact id and scope, read before dispatch. */
export function invoiceResidualBefore(
  moves: readonly InvoicePaymentProjection[],
  organizationId: bigint,
  companyId: bigint,
  invoiceMoveId: bigint,
): number | null {
  const move = exactInvoice(moves, organizationId, companyId, invoiceMoveId)
  return move ? residualOf(move) : null
}

/**
 * COV-12: resolve a subscription invoice payment as the same invoice move (exact id,
 * organization and company) whose residual dropped below the value read before
 * dispatch and whose payment state is Paid or Partial. A payment held for approval
 * leaves the invoice untouched and is no effect.
 */
export function resolveInvoicePaymentEffect(
  moves: readonly InvoicePaymentProjection[],
  organizationId: bigint,
  companyId: bigint,
  invoiceMoveId: bigint,
  residualBefore: number,
): CanonicalRecordRef | null {
  const move = exactInvoice(moves, organizationId, companyId, invoiceMoveId)
  if (!move) return null
  const residual = residualOf(move)
  if (residual == null || residual > residualBefore - EPSILON) return null
  const state = paymentStateTag(move.paymentState ?? move.payment_state)
  if (state !== "Paid" && state !== "Partial") return null
  return { resource: "account-moves", id: invoiceMoveId.toString() }
}
