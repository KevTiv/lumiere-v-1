/**
 * Original-total document imports are safe to expose only when the same client
 * can finish payment replay. Contract 0.3.108 publishes the generated
 * `apply_historical_payment_allocations` binding, scoped BFF command, and typed
 * query hook. This explicit gate keeps the destructive migration path tied to
 * the complete client stack.
 */
export const HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY = {
  pinnedContractVersion: "0.3.108",
  reducerName: "apply_historical_payment_allocations",
  generatedBinding: true,
  bffCommand: true,
  clientHook: true,
} as const

export function historicalPaymentReplayIsCallable(): boolean {
  return (
    HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.generatedBinding &&
    HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.bffCommand &&
    HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.clientHook
  )
}
