import assert from "node:assert/strict"
import test from "node:test"

import {
  accountPeriodStateTag,
  manualAccountInvoiceParamsToJson,
  paymentParamsToJson,
  toCreateManualAccountInvoiceParams,
  toCreatePaymentParamsFromManualForm,
  toUpdateAccountTaxParams,
  updateAccountTaxParamsForWire,
} from "./accounting-create-params"

test("manual invoice params normalize the modal payload into the generated input", () => {
  const params = toCreateManualAccountInvoiceParams({
    idempotencyKey: "0123456789abcdef0123456789abcdef",
    companyId: "42",
    moveType: { tag: "OutInvoice" },
    journalId: "7",
    partnerId: "11",
    counterpartAccountId: "13",
    currencyId: "1",
    date: "2026-10-15",
    invoiceDate: "2026-10-15",
    invoiceDateDue: "2026-11-15",
    invoicePaymentTermId: "3",
    ref: " INV-42 ",
    lines: [{
      accountId: "19",
      name: " Consulting ",
      quantity: "2",
      priceUnit: "125",
      discount: "10",
      taxIds: ["5"],
      productId: "23",
    }],
  })

  assert.ok(params)
  assert.equal(params.companyId, 42n)
  assert.deepEqual(params.moveType, { tag: "OutInvoice" })
  assert.equal(params.invoiceDate.microsSinceUnixEpoch, BigInt(Date.parse("2026-10-15")) * 1000n)
  assert.equal(params.ref, "INV-42")
  assert.deepEqual(params.lines, [{
    accountId: 19n,
    name: "Consulting",
    quantity: 2,
    priceUnit: 125,
    discount: 10,
    taxIds: [5n],
    productId: 23n,
  }])

  const wire = manualAccountInvoiceParamsToJson(params)
  assert.equal(wire.company_id, 42)
  assert.equal(wire.companyId, undefined)
  assert.deepEqual(wire.move_type, { outInvoice: [] })
  assert.deepEqual(wire.invoice_date_due, {
    some: {
      __timestamp_micros_since_unix_epoch__: Date.parse("2026-11-15") * 1000,
    },
  })
  assert.deepEqual(wire.lines, [{
    account_id: 19,
    name: "Consulting",
    quantity: 2,
    price_unit: 125,
    discount: 10,
    tax_ids: [5],
    product_id: { some: 23 },
  }])
})

test("manual invoice params reject invalid identity, money, and line references", () => {
  const valid = {
    idempotencyKey: "0123456789abcdef0123456789abcdef",
    companyId: "42",
    moveType: "InInvoice",
    journalId: "7",
    partnerId: "11",
    counterpartAccountId: "13",
    currencyId: "1",
    date: "2026-10-15",
    invoiceDate: "2026-10-15",
    lines: [{ accountId: "19", name: "Goods", quantity: 1, priceUnit: 25, discount: 0, taxIds: [] }],
  }

  assert.equal(toCreateManualAccountInvoiceParams({ ...valid, idempotencyKey: "bad" }), null)
  assert.equal(toCreateManualAccountInvoiceParams({ ...valid, lines: [] }), null)
  assert.equal(toCreateManualAccountInvoiceParams({
    ...valid,
    lines: [{ ...valid.lines[0], priceUnit: -1 }],
  }), null)
  assert.equal(toCreateManualAccountInvoiceParams({
    ...valid,
    lines: [{ ...valid.lines[0], taxIds: ["bad"] }],
  }), null)
})

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
