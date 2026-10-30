import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { expenseAllocationsQueryOptions } from "./expenses-allocations"

const realFetch = globalThis.fetch
const scope = { organizationId: 1n, companyId: 2n, expenseId: 9007199254740993n, identity: "actor" }
const snapshot = `v1:${"a".repeat(64)}`
beforeEach(() => registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" })))
afterEach(() => { globalThis.fetch = realFetch; registerLumiereApiClient(null) })

test("allocation read sends exact company/parent and separates all authority/cache scopes", async () => {
  const requests: string[] = []
  globalThis.fetch = async (url) => { requests.push(String(url)); return Response.json({ data: [], snapshot }) }
  const query = expenseAllocationsQueryOptions(scope)
  assert.deepEqual(await query.queryFn(), { rows: [], snapshot })
  assert.deepEqual(requests, ["http://api.test/api/query/expense-allocations?companyId=2&expenseId=9007199254740993"])
  assert.equal(query.retry, false)
  for (const patch of [{ identity: "other" }, { companyId: 3n }, { organizationId: 2n }, { expenseId: 4n }]) {
    assert.notDeepEqual(query.queryKey, expenseAllocationsQueryOptions({ ...scope, ...patch }).queryKey)
  }
})

test("incomplete or disabled allocation scope cannot manually fetch", async () => {
  let count = 0
  globalThis.fetch = async () => { count++; return Response.json({ data: [] }) }
  for (const patch of [{ identity: null }, { identity: "unknown" }, { organizationId: 0n }, { companyId: 0n },
    { expenseId: undefined }, { expenseId: 0n }, { enabled: false }]) {
    const query = expenseAllocationsQueryOptions({ ...scope, ...patch })
    assert.equal(query.enabled, false)
    await assert.rejects(query.queryFn(), /actor, company and expense/)
  }
  assert.equal(count, 0)
})

test("failed, denied and malformed reads never become a successful empty allocation vector", async () => {
  for (const status of [401, 403, 404, 500]) {
    globalThis.fetch = async () => Response.json({ error: "Unavailable" }, { status })
    await assert.rejects(expenseAllocationsQueryOptions(scope).queryFn(), (error: unknown) =>
      Boolean(error && typeof error === "object" && "status" in error && error.status === status))
  }
  for (const payload of [{}, { data: null, snapshot }, { data: [null], snapshot }, { data: [[1]], snapshot },
    { data: [] }, { data: [], snapshot: "not-a-canonical-snapshot" }, { data: [], snapshot, nextCursor: "partial" }]) {
    globalThis.fetch = async () => Response.json(payload)
    await assert.rejects(expenseAllocationsQueryOptions(scope).queryFn())
  }
})
