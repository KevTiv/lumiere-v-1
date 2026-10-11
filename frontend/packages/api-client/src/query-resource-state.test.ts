import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createLumiereApiClient } from "./create-client"
import { queryResourceFailure, queryResourceRows } from "./query-resource-state"

describe("query resource states", () => {
  it("distinguishes ready rows from a successful empty response", () => {
    assert.deepEqual(queryResourceRows([{ id: 1 }]), {
      status: "ready",
      rows: [{ id: 1 }],
    })
    assert.deepEqual(queryResourceRows([]), { status: "empty", rows: [] })
  })

  it("classifies authentication and authorization failures as denied", () => {
    assert.equal(queryResourceFailure(401, "sign in").status, "denied")
    assert.equal(queryResourceFailure(403, "forbidden").status, "denied")
  })

  it("classifies transport and server failures as unavailable", () => {
    assert.equal(queryResourceFailure(503, "offline").status, "unavailable")
    assert.equal(queryResourceFailure(undefined, "network error").status, "unavailable")
  })

  it("classifies HTTP responses without collapsing denied into empty", async () => {
    const originalFetch = globalThis.fetch
    const client = createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" })
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
      assert.equal((await client.fetchQueryListState("/v1/query/things")).status, "empty")

      globalThis.fetch = async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
      assert.equal((await client.fetchQueryListState("/v1/query/things")).status, "denied")

      globalThis.fetch = async () => new Response(JSON.stringify({ error: "offline" }), { status: 503 })
      assert.equal((await client.fetchQueryListState("/v1/query/things")).status, "unavailable")

      globalThis.fetch = async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })
      assert.equal((await client.fetchQueryListState("/v1/query/things")).status, "unavailable")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
