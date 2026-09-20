import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { WorkflowError } from "@lumiere/erp-workflows"

import {
  cancelSaleOrderCommand,
  computeSaleOrderTotalsCommand,
  createSaleOrderLineCommand,
  deleteSaleOrderLineCommand,
  lockSaleOrderCommand,
  sendSaleOrderQuotationCommand,
  unlockSaleOrderCommand,
} from "./sales"

const realFetch = globalThis.fetch

function respondWith(status: number, body: string) {
  const requests: Array<{ url: string; body: string }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") })
    return new Response(body, { status })
  }) as typeof fetch
  return requests
}

beforeEach(() => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" }))
})

afterEach(() => {
  globalThis.fetch = realFetch
  registerLumiereApiClient(null)
})

describe("sale order lifecycle commands", () => {
  it("sends a quotation through the generated command with only the order id", async () => {
    const requests = respondWith(200, "{}")
    await sendSaleOrderQuotationCommand(12n)
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /send_sale_order_quotation/)
    assert.match(requests[0].body, /12/)
  })

  it("classifies a rejected send by status instead of collapsing it to a generic error", async () => {
    respondWith(403, JSON.stringify({ error: "permission denied" }))
    await assert.rejects(sendSaleOrderQuotationCommand(12n), (error: unknown) => {
      assert.ok(error instanceof WorkflowError)
      assert.equal(error.kind, "permission_denied")
      assert.equal(error.message, "permission denied")
      return true
    })
  })

  it("points an invoiced-order cancel at a return and credit note, keeping the typed kind", async () => {
    respondWith(
      409,
      JSON.stringify({ error: "Cannot cancel an invoiced sale order — create a credit note / return instead" }),
    )
    await assert.rejects(cancelSaleOrderCommand({ orderId: 3n }), (error: unknown) => {
      assert.ok(error instanceof WorkflowError)
      assert.equal(error.kind, "conflict")
      assert.match(error.message, /create an RMA and credit note/)
      return true
    })
  })

  it("leaves other cancel failures untouched", async () => {
    respondWith(422, JSON.stringify({ error: "Cannot cancel a done order" }))
    await assert.rejects(cancelSaleOrderCommand({ orderId: 3n }), (error: unknown) => {
      assert.ok(error instanceof WorkflowError)
      assert.equal(error.kind, "validation")
      assert.equal(error.message, "Cannot cancel a done order")
      return true
    })
  })

  it("resolves quietly when the server accepts the cancel", async () => {
    const requests = respondWith(200, "{}")
    await cancelSaleOrderCommand({ orderId: 3n, reason: "duplicate" })
    assert.match(requests[0].body, /duplicate/)
  })

  it("locks and unlocks through their own generated commands", async () => {
    const requests = respondWith(200, "{}")
    await lockSaleOrderCommand(5n)
    await unlockSaleOrderCommand(5n)
    assert.match(requests[0].url, /lock_sale_order/)
    assert.doesNotMatch(requests[0].url, /unlock/)
    assert.match(requests[1].url, /unlock_sale_order/)
  })

  it("reports a locked order on a line change as a typed conflict with the server's reason", async () => {
    respondWith(409, JSON.stringify({ error: "Sale order is locked" }))
    await assert.rejects(deleteSaleOrderLineCommand(9n), (error: unknown) => {
      assert.ok(error instanceof WorkflowError)
      assert.equal(error.kind, "conflict")
      assert.equal(error.message, "Sale order is locked")
      return true
    })
  })

  it("surfaces the server's message for a rejected line create instead of a generic failure", async () => {
    respondWith(422, JSON.stringify({ error: "Only draft or sent orders can receive new lines" }))
    await assert.rejects(
      createSaleOrderLineCommand({ orderId: 4n, params: {} as never }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError)
        assert.equal(error.kind, "validation")
        assert.match(error.message, /draft or sent/)
        return true
      },
    )
  })

  it("keeps a totals recalculation failure typed, and retryable when the gateway is down", async () => {
    respondWith(503, "upstream unavailable")
    await assert.rejects(computeSaleOrderTotalsCommand(5n), (error: unknown) => {
      assert.ok(error instanceof WorkflowError)
      assert.equal(error.kind, "retryable_transport")
      assert.equal(error.retryable, true)
      return true
    })
  })
})
