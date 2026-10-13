import assert from "node:assert/strict"
import test from "node:test"

import {
  accountPeriodStateTag,
  paymentParamsToJson,
  toCreatePaymentParamsFromManualForm,
  toUpdateAccountTaxParams,
  updateAccountTaxParamsForWire,
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

test("account period state tag reads tagged, string and SATS sum JSON states", () => {
  assert.equal(accountPeriodStateTag({ state: { tag: "Open" } }), "Open")
  assert.equal(accountPeriodStateTag({ state: "Draft" }), "Draft")
  assert.equal(accountPeriodStateTag({ state: { open: [] } }), "Open")
  assert.equal(accountPeriodStateTag({ state: { closed: [] } }), "Closed")
})

test("update tax params send only the edited fields and keep an empty description unchanged", () => {
  const params = toUpdateAccountTaxParams({
    name: " VAT 21 ",
    description: "  ",
    typeTaxUse: "withholding",
    amount: "21",
    active: false,
    priceInclude: true,
  })
  assert.equal(params.name, "VAT 21")
  assert.equal(params.description, undefined)
  assert.deepEqual(params.typeTaxUse, { tag: "Withholding" })
  assert.equal(params.amount, 21)
  assert.equal(params.active, false)
  assert.equal(params.priceInclude, true)
  assert.equal(params.tags, undefined)
  assert.equal(toUpdateAccountTaxParams({ amount: "" }).amount, undefined)
})

test("update tax wire params wrap the enum option and the nested description option", () => {
  const wire = updateAccountTaxParamsForWire(
    toUpdateAccountTaxParams({ name: "VAT", description: "Standard", typeTaxUse: "sale" }),
  ) as unknown as Record<string, unknown>
  assert.deepEqual(wire.typeTaxUse, { some: { tag: "Sale" } })
  assert.deepEqual(wire.description, { some: { some: "Standard" } })
  const bare = updateAccountTaxParamsForWire(toUpdateAccountTaxParams({ name: "VAT" })) as unknown as Record<string, unknown>
  assert.deepEqual(bare.typeTaxUse, { none: [] })
  assert.equal(bare.description, undefined)
})
