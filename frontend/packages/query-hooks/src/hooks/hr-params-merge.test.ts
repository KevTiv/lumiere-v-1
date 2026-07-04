import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { finalizeUpdateLeaveTypeParams } from "./hr-params-merge"

describe("finalizeUpdateLeaveTypeParams", () => {
  it("includes only explicitly provided leave type fields", () => {
    const params = finalizeUpdateLeaveTypeParams({ name: "Annual Leave" })
    assert.deepEqual(params, { name: "Annual Leave" })
    assert.ok(!("maxLeaves" in params))
    assert.ok(!("isActive" in params))
  })

  it("returns an empty object for an empty partial", () => {
    assert.deepEqual(finalizeUpdateLeaveTypeParams({}), {})
  })
})
