import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  toCreatePurchaseBlanketOrderParams,
  toCreateVendorCreditFromPurchaseReturnParams,
} from "./purchasing-coverage-create-params"
import { toReceivePoLineArgs } from "./purchasing-create-params"

describe("purchasing coverage create params — fail-closed FKs", () => {
  it("returns null when vendor-credit journal/accounts missing", () => {
    assert.equal(
      toCreateVendorCreditFromPurchaseReturnParams({
        expenseAccountId: 2n,
        payableAccountId: 3n,
      }),
      null,
    )
    assert.equal(
      toCreateVendorCreditFromPurchaseReturnParams({
        journalId: 1n,
        expenseAccountId: 2n,
      }),
      null,
    )
  })

  it("returns null when vendor-credit FKs are magic 0n", () => {
    assert.equal(
      toCreateVendorCreditFromPurchaseReturnParams({
        journalId: 0n,
        expenseAccountId: 2n,
        payableAccountId: 3n,
      }),
      null,
    )
    assert.equal(
      toCreateVendorCreditFromPurchaseReturnParams({
        journalId: 1n,
        expenseAccountId: 0,
        payableAccountId: 3n,
      }),
      null,
    )
  })

  it("maps vendor credit when required FKs are present", () => {
    const params = toCreateVendorCreditFromPurchaseReturnParams({
      journalId: 1n,
      expenseAccountId: 2n,
      payableAccountId: 3n,
    })
    assert.ok(params)
    assert.equal(params.journalId, 1n)
    assert.equal(params.expenseAccountId, 2n)
    assert.equal(params.payableAccountId, 3n)
  })
})

describe("toReceivePoLineArgs — lot_id plumbing", () => {
  it("omits lotId when absent (backend enforces lot-tracked products)", () => {
    assert.deepEqual(toReceivePoLineArgs({ lineId: 10, qty: 2 }), { lineId: 10, qty: 2 })
    assert.deepEqual(toReceivePoLineArgs({ lineId: 10, qty: 2, lotId: "" }), {
      lineId: 10,
      qty: 2,
    })
  })

  it("includes lotId when provided", () => {
    assert.deepEqual(toReceivePoLineArgs({ lineId: 10, qty: 2, lotId: 99 }), {
      lineId: 10,
      qty: 2,
      lotId: 99,
    })
  })

  it("returns null for invalid lotId sentinel", () => {
    assert.equal(toReceivePoLineArgs({ lineId: 10, qty: 2, lotId: 0 }), null)
    assert.equal(toReceivePoLineArgs({ lineId: 10, qty: 2, lotId: -1 }), null)
  })
})

const validBlanket = {
  name: "Annual packaging",
  partnerId: 10n,
  currencyId: 1n,
  lines: [
    {
      productId: 20n,
      productUom: 3n,
      committedQuantity: 100,
      priceUnit: 4.5,
    },
  ],
}

describe("toCreatePurchaseBlanketOrderParams", () => {
  it("maps required authoritative lines", () => {
    const params = toCreatePurchaseBlanketOrderParams(validBlanket)
    assert.ok(params)
    assert.equal(params.lines.length, 1)
    assert.equal(params.lines[0]?.productId, 20n)
  })

  it("fails closed for absent, zero, or invalid blanket lines", () => {
    assert.equal(toCreatePurchaseBlanketOrderParams({ ...validBlanket, lines: [] }), null)
    assert.equal(
      toCreatePurchaseBlanketOrderParams({
        ...validBlanket,
        lines: [{ ...validBlanket.lines[0], productId: 0 }],
      }),
      null,
    )
    assert.equal(
      toCreatePurchaseBlanketOrderParams({
        ...validBlanket,
        lines: [{ ...validBlanket.lines[0], committedQuantity: 0 }],
      }),
      null,
    )
    assert.equal(
      toCreatePurchaseBlanketOrderParams({
        ...validBlanket,
        lines: [{ ...validBlanket.lines[0], priceUnit: Number.POSITIVE_INFINITY }],
      }),
      null,
    )
  })
})
