import assert from "node:assert/strict"
import { test } from "node:test"

import { HttpResponseError, httpResponseError } from "./response-error"

test("HTTP response errors preserve status and server message for query classification", async () => {
  for (const status of [401, 403, 503]) {
    const error = await httpResponseError(
      new Response(JSON.stringify({ message: `query failed with ${status}` }), {
        status,
        headers: { "content-type": "application/json" },
      }),
      "Query failed",
    )

    assert.ok(error instanceof HttpResponseError)
    assert.ok(error instanceof Error)
    assert.equal(error.name, "HttpResponseError")
    assert.equal(error.status, status)
    assert.equal(error.message, `query failed with ${status}`)
  }
})

test("typed errors retain recovery metadata and fall back on non-object bodies", async () => {
  const error = await httpResponseError(Response.json({
    error: "AI setup is incomplete",
    code: "ai_default_agent_not_provisioned",
    recovery_path: "/ai-skills",
  }, { status: 503 }))
  assert.equal(error.code, "ai_default_agent_not_provisioned")
  assert.equal(error.recoveryPath, "/ai-skills")
  assert.equal(error.message, "AI setup is incomplete")

  const malformed = await httpResponseError(Response.json(null, { status: 503 }), "Unavailable")
  assert.equal(malformed.message, "Unavailable")
  assert.equal(malformed.code, undefined)
  assert.equal(malformed.recoveryPath, undefined)
})
