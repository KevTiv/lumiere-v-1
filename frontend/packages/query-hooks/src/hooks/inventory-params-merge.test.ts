import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { finalizeUpdateProductParams } from "./inventory-params-merge"

describe("finalizeUpdateProductParams", () => {
  it("includes only explicitly provided product fields", () => {
    const params = finalizeUpdateProductParams({ name: "Widget Pro" })
    assert.deepEqual(params, { name: "Widget Pro" })
    assert.ok(!("listPrice" in params))
    assert.ok(!("active" in params))
  })

  it("returns an empty object for an empty partial", () => {
    assert.deepEqual(finalizeUpdateProductParams({}), {})
  })
})
