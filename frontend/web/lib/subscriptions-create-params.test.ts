import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { toCreateSubscriptionFromSaleOrderParams } from "./subscriptions-create-params"

describe("subscription create-from-sale-order params", () => {
  it("builds params from the narrowed sale-orders read model", () => {
    const params = toCreateSubscriptionFromSaleOrderParams(
      { saleOrderId: "4097", planId: "2", code: "SUB-X", dateStart: "2026-10-17" },
      [{ id: 4097, partnerId: 423, companyId: 366, state: "Sale" }],
      358n,
    )
    assert.ok(params)
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
