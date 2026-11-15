import assert from "node:assert/strict"
import test from "node:test"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { HttpResponseError } from "@lumiere/api-client/response-error"
import { documentLegalHoldQueryOptions } from "./documents"

test("legal hold reads use the document owning company and distinct actor caches", async context => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://erp.test" }))
  context.after(() => registerLumiereApiClient(null))
  const fetch = context.mock.method(globalThis, "fetch", async (_input: string | URL | Request) => Response.json({
    data: [{ id: 2, documentId: 3, isActive: true }],
  }))
  const options = documentLegalHoldQueryOptions(4n, 5n, "alice")
  assert.notDeepEqual(options.queryKey, documentLegalHoldQueryOptions(4n, 5n, "bob").queryKey)
  assert.notDeepEqual(options.queryKey, documentLegalHoldQueryOptions(4n, 6n, "alice").queryKey)
  assert.deepEqual(await options.queryFn(), [{ id: 2, documentId: 3, isActive: true }])
  assert.equal(fetch.mock.calls[0].arguments[0], "http://erp.test/api/query/document-legal-holds?companyId=5")
})

test("legal hold errors and redacted statuses cannot read as no active hold", async context => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://erp.test" }))
  context.after(() => registerLumiereApiClient(null))
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ error: "Unavailable" }, { status: 503 }))
  const { queryFn } = documentLegalHoldQueryOptions(4n, 5n, "alice")
  await assert.rejects(queryFn(), (error) => error instanceof HttpResponseError && error.status === 503)
  fetch.mock.mockImplementation(async () => Response.json({ data: [{ id: 2, documentId: 3 }] }))
  await assert.rejects(queryFn(), /could not be verified/)
  fetch.mock.mockImplementation(async () => Response.json({ data: [] }))
  assert.deepEqual(await queryFn(), [])
})
