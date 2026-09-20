import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import { QueryClient } from "@tanstack/react-query"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { INVENTORY_QUERY_RESOURCES, PICKING_ORDER_RESOURCES, WorkflowError } from "@lumiere/erp-workflows"

import { invalidateFulfillmentQueries, invalidateInventoryQueries } from "./inventory/shared"
import {
  doneStockMoveCommand,
  packStockPickingCommand,
  validateStockPickingWithQuantitiesCommand,
} from "./inventory/stock-operations"

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

function invalidatedResources(run: (qc: QueryClient) => void): string[] {
  const qc = new QueryClient()
  const seen = new Set<string>()
  const original = qc.invalidateQueries.bind(qc)
  qc.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    const head = filters?.queryKey?.[0]
    if (typeof head === "string") seen.add(head)
    return original(filters as never)
  }) as typeof qc.invalidateQueries
  run(qc)
  return [...seen]
}

describe("inventory invalidation", () => {
  it("still refreshes every inventory list it did before it read from the shared resource list", () => {
    const seen = invalidatedResources((qc) => invalidateInventoryQueries(qc, 1n))
    for (const resource of INVENTORY_QUERY_RESOURCES) assert.ok(seen.includes(resource), resource)
  })

  it("a fulfillment transition also refreshes the orders that originated the picking", () => {
    const seen = invalidatedResources((qc) => invalidateFulfillmentQueries(qc, 1n))
    for (const resource of PICKING_ORDER_RESOURCES) assert.ok(seen.includes(resource), resource)
  })
})

describe("picking commands", () => {
  it("records a short-shipped quantity through done_stock_move", async () => {
    const requests = respondWith(200, "{}")
    await doneStockMoveCommand(3n, { moveId: 11n, quantityDone: 6 })
    assert.match(requests[0].url, /done_stock_move/)
    assert.match(requests[0].body, /6/)
  })

  it("types a rejected done_stock_move instead of a generic failure", async () => {
    respondWith(422, JSON.stringify({ error: "Quantity done exceeds demand" }))
    await assert.rejects(doneStockMoveCommand(3n, { moveId: 11n, quantityDone: 99 }), (error: unknown) => {
      assert.ok(error instanceof WorkflowError)
      assert.equal(error.kind, "validation")
      assert.equal(error.message, "Quantity done exceeds demand")
      return true
    })
  })

  it("packs a picking with only its id and reports a repeat pack as a conflict", async () => {
    const requests = respondWith(409, JSON.stringify({ error: "Move 4 is already in a package" }))
    await assert.rejects(
      packStockPickingCommand(3n, {
        pickingId: 8n,
        packagingMaterialId: undefined,
        name: undefined,
        metadata: undefined,
      }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowError)
        assert.equal(error.kind, "conflict")
        return true
      },
    )
    assert.match(requests[0].url, /pack_stock_picking/)
  })

  it("records short-shipped quantities before validating, in order", async () => {
    const requests = respondWith(200, "{}")
    await validateStockPickingWithQuantitiesCommand(3n, {
      pickingId: 8n,
      shortMoves: [
        { moveId: 11n, quantityDone: 6 },
        { moveId: 12n, quantityDone: 1 },
      ],
      createBackorder: false,
    })
    const order = requests.map((r) => r.url.match(/(done_stock_move|validate_stock_picking_backorder|validate_stock_picking)/)?.[1])
    assert.deepEqual(order, ["done_stock_move", "done_stock_move", "validate_stock_picking"])
  })

  it("validates with a backorder through the backorder reducer", async () => {
    const requests = respondWith(200, "{}")
    await validateStockPickingWithQuantitiesCommand(3n, { pickingId: 8n, shortMoves: [], createBackorder: true })
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /validate_stock_picking_backorder/)
  })

  it("never validates when recording a quantity fails", async () => {
    const requests = respondWith(422, JSON.stringify({ error: "Quantity done exceeds demand" }))
    await assert.rejects(
      validateStockPickingWithQuantitiesCommand(3n, {
        pickingId: 8n,
        shortMoves: [{ moveId: 11n, quantityDone: 99 }],
        createBackorder: false,
      }),
      WorkflowError,
    )
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /done_stock_move/)
  })
})
