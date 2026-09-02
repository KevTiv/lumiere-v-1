import assert from "node:assert/strict"
import test from "node:test"

import {
  paymentParamsToJson,
  toCreatePaymentParamsFromManualForm,
} from "./accounting-create-params"

test("manual payment params require and encode the selected business date", () => {
  const params = toCreatePaymentParamsFromManualForm(
    {
      paymentType: "InBound",
      partnerType: "Customer",
      partnerId: "223",
      amount: "2400",
      currencyId: "1",
      journalId: "35",
      date: "2026-08-29",
    },
    198n,
  )

  assert.ok(params)
  assert.equal(params.partnerId, 223n)
  assert.equal(params.date?.microsSinceUnixEpoch, BigInt(Date.parse("2026-08-29")) * 1000n)
  assert.deepEqual(paymentParamsToJson(params).date, {
    some: {
      __timestamp_micros_since_unix_epoch__: Date.parse("2026-08-29") * 1000,
    },
  })
})

test("manual payment params reject a missing business date", () => {
  assert.throws(
    () =>
      toCreatePaymentParamsFromManualForm(
        {
          partnerId: "223",
          amount: "2400",
          currencyId: "1",
          journalId: "35",
        },
        198n,
      ),
    /valid business date is required/i,
  )
})
