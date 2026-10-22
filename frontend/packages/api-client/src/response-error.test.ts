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
