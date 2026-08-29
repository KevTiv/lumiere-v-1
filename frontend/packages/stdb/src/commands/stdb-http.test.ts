import assert from "node:assert/strict"
import test from "node:test"

import { encodeIdentity } from "../stdb-params-json"
import { stdbBffCommandPost } from "./stdb-http"

test("assign_ticket accepts and emits the SpacetimeDB identity wire shape", () => {
  const identity = "ab".repeat(32)
  const { init } = stdbBffCommandPost("assign_ticket", {
    ticketId: 42n,
    agentId: encodeIdentity(identity),
  })

  assert.deepEqual(JSON.parse(String(init.body)), {
    ticketId: 42,
    agentId: { __identity__: `0x${identity}` },
  })
})
