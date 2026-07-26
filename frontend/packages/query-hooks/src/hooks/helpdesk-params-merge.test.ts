import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  finalizeCreateHelpdeskSlaParams,
  finalizeCreateTicketParams,
  finalizeUpdateTicketParams,
} from "./helpdesk-params-merge"

describe("finalizeCreateTicketParams", () => {
  it("rejects missing or zero teamId/stageId", () => {
    assert.throws(
      () => finalizeCreateTicketParams({ name: "No team", stageId: 1n }),
      /teamId is required/,
    )
    assert.throws(
      () => finalizeCreateTicketParams({ name: "Zero team", teamId: 0n, stageId: 1n }),
      /teamId is required/,
    )
    assert.throws(
      () => finalizeCreateTicketParams({ name: "No stage", teamId: 1n }),
      /stageId is required/,
    )
    assert.throws(
      () => finalizeCreateTicketParams({ name: "Zero stage", teamId: 1n, stageId: 0n }),
      /stageId is required/,
    )
  })

  it("passes through required ticket ids", () => {
    const params = finalizeCreateTicketParams({
      name: "Ticket",
      teamId: 9n,
      stageId: 3n,
    })
    assert.equal(params.teamId, 9n)
    assert.equal(params.stageId, 3n)
    assert.equal(params.name, "Ticket")
  })
})

describe("finalizeCreateHelpdeskSlaParams", () => {
  it("rejects missing or zero teamId/stageId", () => {
    assert.throws(
      () => finalizeCreateHelpdeskSlaParams({ name: "SLA", stageId: 1n }),
      /teamId is required/,
    )
    assert.throws(
      () => finalizeCreateHelpdeskSlaParams({ name: "SLA", teamId: 1n, stageId: 0n }),
      /stageId is required/,
    )
  })
})

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
