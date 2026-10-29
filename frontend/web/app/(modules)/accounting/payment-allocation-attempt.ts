
import { i18n } from "@lumiere/i18n"
import type { AllocatePaymentParams } from "@lumiere/stdb/types"

export interface PaymentAllocationAttempt {
  organizationId: bigint
  params: AllocatePaymentParams
}

/** Keep an uncertain command's key and payload together so retries cannot allocate twice. */
export function preparePaymentAllocationAttempt(
  previous: PaymentAllocationAttempt | null,
  organizationId: bigint,
  params: Omit<AllocatePaymentParams, "idempotencyKey">,
  createKey: () => string,
): PaymentAllocationAttempt {
  if (!previous) return { organizationId, params: { ...params, idempotencyKey: createKey() } }
  const { idempotencyKey: _key, ...previousParams } = previous.params
  const encode = (value: unknown) => JSON.stringify(value, (_name, entry: unknown) => typeof entry === "bigint" ? entry.toString() : entry)
  if (previous.organizationId !== organizationId || encode(previousParams) !== encode(params)) {
    throw new Error(i18n.t("accounting.paymentAllocationAttempt.anAllocationResponseIsUnresolvedRetryTheOriginalPaymentLineAnd"))
  }
  return previous
}

/** Ordinary client validation/authorization rejection confirms that no command committed. */
export function allocationFailureIsDefinitive(cause: unknown, previousOutcomeUnknown = false): boolean {
  // A rejected retry says nothing about whether the earlier request committed.
  if (previousOutcomeUnknown) return false
  const status = cause && typeof cause === "object" && "status" in cause ? cause.status : undefined
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429
}
