import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type SubscriptionBillingRunProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly subscriptionId?: unknown
  readonly subscription_id?: unknown
  readonly billingRunKey?: unknown
  readonly billing_run_key?: unknown
  readonly invoiceMoveId?: unknown
  readonly invoice_move_id?: unknown
}

export type AccountMoveScopeProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
}

/** The run-key inputs of `GenerateSubscriptionInvoiceParams`, in camelCase or wire snake_case. */
export type SubscriptionRunKeyParams = {
  readonly billingRunKey?: unknown
  readonly billing_run_key?: unknown
  readonly invoiceDate?: unknown
  readonly invoice_date?: unknown
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (value && typeof value === "object" && "some" in value) return optionalText((value as { some: unknown }).some)
  return null
}

function timestampMicros(value: unknown): bigint | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const inner = record.microsSinceUnixEpoch ?? record.__timestamp_micros_since_unix_epoch__
    return inner === undefined ? null : (parseStrictU64(inner) ?? null)
  }
  return parseStrictU64(value) ?? null
}

/**
 * The billing-run key the reducer will use: the explicit key when given, else
 * its default `sub:{subscription id}:period:{invoice date seconds}`
 * (`default_billing_run_key`). `null` when neither can be determined, in which
 * case the effect can not be read back exactly.
 */
export function subscriptionBillingRunKey(
  subscriptionId: bigint,
  params: SubscriptionRunKeyParams,
): string | null {
  const explicit = optionalText(params.billingRunKey ?? params.billing_run_key)
  if (explicit) return explicit
  const micros = timestampMicros(params.invoiceDate ?? params.invoice_date)
  if (micros == null) return null
  return `sub:${subscriptionId}:period:${micros / 1_000_000n}`
}

/**
 * COV-12: resolve the billing run for one (subscription, billing-run key) in the
 * same organization and company, and return the invoice move it points at.
 * Never "the newest invoice": a run key is unique, and a duplicate is an
 * invariant failure.
 */
export function resolveSubscriptionInvoiceRunEffect(
  runs: readonly SubscriptionBillingRunProjection[],
  organizationId: bigint,
  companyId: bigint,
  subscriptionId: bigint,
  billingRunKey: string,
): { readonly runId: bigint; readonly invoiceMoveId: bigint } | null {
  const matches = runs.filter((run) => String(run.billingRunKey ?? run.billing_run_key ?? "") === billingRunKey)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one billing run, found ${matches.length}`)
  }
  const run = matches[0]
  if (!run) return null
  const runId = parseStrictU64(run.id)
  const invoiceMoveId = parseStrictU64(run.invoiceMoveId ?? run.invoice_move_id)
  if (
    runId == null
    || invoiceMoveId == null
    || invoiceMoveId === 0n
    || parseStrictU64(run.organizationId ?? run.organization_id) !== organizationId
    || parseStrictU64(run.companyId ?? run.company_id) !== companyId
    || parseStrictU64(run.subscriptionId ?? run.subscription_id) !== subscriptionId
  ) return null
  return { runId, invoiceMoveId }
}

/** Resolve the run's invoice move as one account move in the same organization and company. */
export function resolveSubscriptionInvoiceMove(
  moves: readonly AccountMoveScopeProjection[],
  organizationId: bigint,
  companyId: bigint,
  invoiceMoveId: bigint,
): CanonicalRecordRef | null {
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
  return { resource: "account-moves", id: invoiceMoveId.toString() }
}
