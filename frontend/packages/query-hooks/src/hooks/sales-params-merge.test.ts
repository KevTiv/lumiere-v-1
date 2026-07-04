import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { finalizeUpdateSaleOrderParams } from "./sales-params-merge.ts"

describe("finalizeUpdateSaleOrderParams", () => {
  it("includes only explicitly provided sale order fields", () => {
    const params = finalizeUpdateSaleOrderParams({ note: "Rush order" })
    assert.deepEqual(params, { note: "Rush order" })
    assert.ok(!("clientOrderRef" in params))
    assert.ok(!("warehouseId" in params))
  })

  it("returns an empty object for an empty partial", () => {
    assert.deepEqual(finalizeUpdateSaleOrderParams({}), {})
  })
})
