import assert from "node:assert/strict"
import test from "node:test"

import {
  HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY,
  historicalPaymentReplayIsCallable,
} from "./historical-payment-replay-capability"

test("contract 0.3.108 exposes original-total imports only with the complete replay client path", () => {
  assert.equal(
    HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.reducerName,
    "apply_historical_payment_allocations",
  )
  assert.equal(HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.pinnedContractVersion, "0.3.108")
  assert.equal(HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.generatedBinding, true)
  assert.equal(HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.bffCommand, true)
  assert.equal(HISTORICAL_PAYMENT_REPLAY_CLIENT_CAPABILITY.clientHook, true)
  assert.equal(historicalPaymentReplayIsCallable(), true)
})
