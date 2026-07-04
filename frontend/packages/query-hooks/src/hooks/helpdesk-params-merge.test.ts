import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { finalizeUpdateTicketParams } from "./helpdesk-params-merge"

describe("finalizeUpdateTicketParams", () => {
  it("includes only explicitly provided ticket fields", () => {
    const params = finalizeUpdateTicketParams({ name: "Updated ticket" })
    assert.deepEqual(params, { name: "Updated ticket" })
    assert.ok(!("description" in params))
    assert.ok(!("stageId" in params))
  })

  it("returns an empty object for an empty partial", () => {
    assert.deepEqual(finalizeUpdateTicketParams({}), {})
  })
})
