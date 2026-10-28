import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { toCreateSubscriptionFromSaleOrderParams, toCreateSubscriptionPlanParams } from "./subscriptions-create-params"

describe("subscription create-from-sale-order params", () => {
  it("builds params from the narrowed sale-orders read model", () => {
    const params = toCreateSubscriptionFromSaleOrderParams(
      { saleOrderId: "4097", planId: "2", code: "SUB-X", dateStart: "2026-10-17" },
      [{ id: 4097, partnerId: 423, companyId: 366, state: "Sale" }],
      366n,
    )
    assert.ok(params)
    assert.equal(params.companyId, 366n)
    assert.equal(params.saleOrderId, 4097n)
    assert.equal(params.planId, 2n)
    assert.equal(params.partnerId, 423n)
    assert.equal(params.partnerInvoiceId, 423n)
    assert.equal(params.partnerShippingId, 423n)
  })

  it("still rejects an unknown order or a missing partner", () => {
    assert.equal(
      toCreateSubscriptionFromSaleOrderParams({ saleOrderId: "9", planId: "2" }, [], 358n),
      null,
    )
    assert.equal(
      toCreateSubscriptionFromSaleOrderParams(
        { saleOrderId: "9", planId: "2", dateStart: "2026-10-17" },
        [{ id: 9 }],
        358n,
      ),
      null,
    )
  })
})


describe("subscription form scope and exact identifiers", () => {
  it("rejects an order outside the selected company before dispatch", () => {
    const values = { saleOrderId: "9", planId: "2", dateStart: "2026-10-27" }
    const orders = [{ id: 9n, partnerId: 7n, companyId: 11n }]
    assert.equal(toCreateSubscriptionFromSaleOrderParams(values, orders, 12n), null)
    assert.equal(toCreateSubscriptionFromSaleOrderParams(values, orders, 0n), null)
    assert.equal(toCreateSubscriptionFromSaleOrderParams(values, [{ id: 9n, partnerId: 7n }], 11n), null)
  })

  it("keeps selected u64 strings exact and retains server-owned starting state", () => {
    const orderId = "9007199254740993", planId = "9007199254740995", partnerId = "9007199254740997"
    const params = toCreateSubscriptionFromSaleOrderParams(
      { saleOrderId: orderId, planId, dateStart: "2026-10-27", state: "open", health: "bad" },
      [{ id: orderId, partnerId, companyId: "11", state: "Sale" }],
      11n,
    )!
    assert.equal(params.saleOrderId, BigInt(orderId))
    assert.equal(params.planId, BigInt(planId))
    assert.equal(params.partnerId, BigInt(partnerId))
    assert.equal(params.companyId, 11n)
    assert.equal(params.state, "draft")
    assert.equal(params.health, "healthy")
    assert.equal(params.isActive, false)
  })

  it("preserves plan currency provenance and exact selected journal and product IDs", () => {
    const journalId = "9007199254740993", productId = "9007199254740995", currencyId = "9007199254740997"
    const params = toCreateSubscriptionPlanParams(
      { name: "Annual support", pricelistId: "4", journalId, productId, billingPeriod: "year", billingPeriodUnit: 2 },
      [{ id: "4", currencyId }],
      11n,
    )!
    assert.equal(params.companyId, 11n)
    assert.equal(params.currencyId, BigInt(currencyId))
    assert.equal(params.journalId, BigInt(journalId))
    assert.equal(params.productId, BigInt(productId))
    assert.equal(params.billingPeriod, "year")
    assert.equal(params.billingPeriodUnit, 2)
    assert.equal(toCreateSubscriptionPlanParams({ name: "Incomplete", pricelistId: "4", journalId, productId }, [{ id: "4" }], 11n), null)
  })
})
