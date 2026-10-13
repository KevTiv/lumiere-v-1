import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { QueryClient, QueryObserver } from "@tanstack/react-query"

import {
  leaveAllocationsQueryOptions,
  offboardingChecklistsQueryOptions,
  statutoryIdsQueryOptions,
} from "./reads-options"

const realFetch = globalThis.fetch

beforeEach(() => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" }))
})

afterEach(() => {
  globalThis.fetch = realFetch
  registerLumiereApiClient(null)
})

function respondWith(status: number, payload: unknown) {
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    requests.push(String(input))
    return new Response(JSON.stringify(payload), { status })
  }
  return requests
}

const resources = [
  { resource: "hr-leave-allocations", options: leaveAllocationsQueryOptions, stateAware: false },
  { resource: "hr-offboarding-checklists", options: offboardingChecklistsQueryOptions, stateAware: true },
  { resource: "hr-statutory-ids", options: statutoryIdsQueryOptions, stateAware: true },
] as const

for (const { resource, options, stateAware } of resources) {
  describe(resource, () => {
    it("builds company-specific keys and sends the selected company as query intent", async () => {
      const rows = [{ label: "selected company" }]
      const requests = respondWith(200, { data: rows })
      const query = options(9007199254740993n, { activeCompanyId: 42, activeCompanyReady: true })
      assert.deepEqual(query.queryKey, [resource, "9007199254740993", "company", 42])
      assert.equal(query.enabled, true)
      assert.equal(query.staleTime, 30_000)
      assert.deepEqual(await query.queryFn(), stateAware ? { status: "ready", rows } : rows)
      assert.deepEqual(requests, [`http://api.test/api/query/${resource}?companyId=42`])
      assert.notDeepEqual(query.queryKey, options(2n, { activeCompanyId: 42, activeCompanyReady: true }).queryKey)
    })

    it("does not fetch before company readiness or without valid organization/company scope", () => {
      const requests = respondWith(200, { data: [] })
      const disabledScopes = [
        { organizationId: 1n, activeCompanyId: 42, activeCompanyReady: false },
        { organizationId: 1n, activeCompanyId: 42, activeCompanyReady: undefined },
        { organizationId: 1n, activeCompanyId: null, activeCompanyReady: true },
        { organizationId: 1n, activeCompanyId: undefined, activeCompanyReady: true },
        { organizationId: 1n, activeCompanyId: 0, activeCompanyReady: true },
        { organizationId: 1n, activeCompanyId: -1, activeCompanyReady: true },
        { organizationId: 0n, activeCompanyId: 42, activeCompanyReady: true },
        { organizationId: -1n, activeCompanyId: 42, activeCompanyReady: true },
      ]
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      try {
        for (const { organizationId, ...scope } of disabledScopes) {
          const query = options(organizationId, scope)
          assert.equal(query.enabled, false)
          const observer = new QueryObserver<unknown>(client, query)
          const unsubscribe = observer.subscribe(() => { })
          assert.equal(observer.getCurrentResult().fetchStatus, "idle")
          assert.throws(() => query.queryFn(), /An active company and organization are required/)
          unsubscribe()
        }
        assert.deepEqual(requests, [])
      } finally {
        client.clear()
      }
    })

    it("does not reuse old company data while unready or after switching companies", async () => {
      const requests = respondWith(200, { data: [{ label: "company A" }] })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      const companyA = options(1n, { activeCompanyId: 42, activeCompanyReady: true })
      const companyB = options(1n, { activeCompanyId: 43, activeCompanyReady: true })
      const unready = options(1n, { activeCompanyId: 42, activeCompanyReady: false })
      const observer = new QueryObserver<unknown>(client, companyA)
      try {
        const dataA = await client.fetchQuery<unknown>(companyA)
        observer.setOptions(companyA)
        assert.deepEqual(observer.getCurrentResult().data, dataA)
        assert.deepEqual(unready.queryKey, [resource, "1", "company", null])
        observer.setOptions(unready)
        assert.equal(observer.getCurrentResult().data, undefined)
        assert.equal(observer.getCurrentResult().fetchStatus, "idle")
        assert.notDeepEqual(companyA.queryKey, companyB.queryKey)
        observer.setOptions(companyB)
        assert.equal(observer.getCurrentResult().data, undefined)
        assert.deepEqual(requests, [`http://api.test/api/query/${resource}?companyId=42`])

        const requestsB = respondWith(200, { data: [{ label: "company B" }] })
        const dataB = await client.fetchQuery<unknown>(companyB)
        assert.deepEqual(requestsB, [`http://api.test/api/query/${resource}?companyId=43`])
        assert.notDeepEqual(dataA, dataB)
        assert.deepEqual(client.getQueryData(companyA.queryKey), dataA)
        assert.deepEqual(client.getQueryData(companyB.queryKey), dataB)
      } finally {
        observer.destroy()
        client.clear()
      }
    })

    it("keeps genuine empty success distinct from failures", async () => {
      respondWith(200, { data: [] })
      const query = options(1n, { activeCompanyId: 42, activeCompanyReady: true })
      assert.deepEqual(await query.queryFn(), stateAware ? { status: "empty", rows: [] } : [])
    })

    for (const status of [401, 403, 409, 503]) {
      it(`preserves ${status} failure semantics instead of silently returning empty rows`, async () => {
        respondWith(status, { error: "scope or permission rejected" })
        const query = options(1n, { activeCompanyId: 42, activeCompanyReady: true })
        if (stateAware) {
          assert.deepEqual(await query.queryFn(), {
            status: status === 401 || status === 403 ? "denied" : "unavailable",
            rows: [],
            message: "scope or permission rejected",
          })
        } else {
          await assert.rejects(query.queryFn(), /Failed to fetch leave allocations/)
        }
      })
    }

    it("preserves network failure semantics", async () => {
      globalThis.fetch = async () => { throw new Error("network unavailable") }
      const query = options(1n, { activeCompanyId: 42, activeCompanyReady: true })
      if (stateAware) {
        assert.deepEqual(await query.queryFn(), {
          status: "unavailable", rows: [], message: "network unavailable",
        })
      } else {
        await assert.rejects(query.queryFn(), /network unavailable/)
      }
    })
  })
}
