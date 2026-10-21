import assert from "node:assert/strict"
import { it } from "node:test"
import { createLumiereApiClient } from "./create-client"

it("preserves concrete HTTP status and existing message on failed query reads", async () => {
  const originalFetch = globalThis.fetch
  try {
    const client = createLumiereApiClient({ baseUrl: "https://example.test" })
    for (const status of [401, 403, 503]) {
      globalThis.fetch = async () => new Response(null, { status })
      await assert.rejects(client.fetchQueryList("/api/query/subscriptions", "Read failed"), (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, "Read failed")
        assert.equal(Reflect.get(error, "status"), status)
        return true
      })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
