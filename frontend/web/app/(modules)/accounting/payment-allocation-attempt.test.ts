import assert from "node:assert/strict"
import test from "node:test"
import { allocationFailureIsDefinitive, preparePaymentAllocationAttempt } from "./payment-allocation-attempt"

const params = { companyId: 7n, paymentTransactionId: 301n, allocatedMoveLineId: 201n, allocatedAmount: 25, currencyId: 1n, writeOffAmount: 0, writeOffAccountId: undefined, metadata: undefined }

test("lost allocation responses reuse the exact key and payload across retries", () => {
  const first = preparePaymentAllocationAttempt(null, 42n, params, () => "allocation-original")
  const retry = preparePaymentAllocationAttempt(first, 42n, { ...params }, () => "must-not-be-used")
  assert.equal(retry, first)
  assert.equal(retry.params.idempotencyKey, "allocation-original")
})

test("an unresolved allocation cannot be repurposed for another amount, line, company or organization", () => {
  const first = preparePaymentAllocationAttempt(null, 42n, params, () => "allocation-original")
  for (const changed of [{ ...params, allocatedAmount: 26 }, { ...params, allocatedMoveLineId: 202n }, { ...params, companyId: 8n }]) {
    assert.throws(() => preparePaymentAllocationAttempt(first, 42n, changed, () => "new"), /unresolved/)
  }
  assert.throws(() => preparePaymentAllocationAttempt(first, 43n, params, () => "new"), /unresolved/)
})

test("network errors and server/time-out responses retain recovery; validation rejection releases it", () => {
  for (const error of [new Error("connection lost"), { status: 500 }, { status: 408 }, { status: 429 }]) assert.equal(allocationFailureIsDefinitive(error), false)
  for (const status of [400, 401, 403, 409, 422]) assert.equal(allocationFailureIsDefinitive({ status }), true)
})

test("a rejected retry preserves the original unknown outcome and immutable command", () => {
  for (const status of [400, 401, 403, 409, 422]) assert.equal(allocationFailureIsDefinitive({ status }, true), false)
})
