import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient } from "@tanstack/react-query"
import { currenciesQueryOptions, fetchCurrencies } from "@lumiere/query-hooks/hooks/settings-currencies"

import {
  StoredDashboardSourceQueryError,
  shouldRetryStoredDashboardSource,
  storedDashboardSourceIssue,
  storedDashboardSourceState,
} from "./stored-dashboard-source-state"

test("saved widget currency metadata uses the scoped catalog options without legacy or cross-tenant reuse", () => {
  const cache = new QueryClient()
  const rows = [{ id: 1, code: "EUR", decimalPlaces: 2 }]
  cache.setQueryData(['currencies'], [{ id: 1, code: "USD", decimalPlaces: 2 }])
  const original = currenciesQueryOptions({ organizationId: 1n, identity: 'actor-a' }).queryKey
  assert.equal(cache.getQueryData(original), undefined)
  cache.setQueryData(original, rows)
  assert.deepEqual(cache.getQueryData(original), rows)
  assert.equal(cache.getQueryData(currenciesQueryOptions({ organizationId: 2n, identity: 'actor-a' }).queryKey), undefined)
  assert.equal(cache.getQueryData(currenciesQueryOptions({ organizationId: 1n, identity: 'actor-b' }).queryKey), undefined)
  cache.clear()
})

test("shared currency read denials remain denied and are not retried by saved widgets", async () => {
  for (const status of [401, 403]) {
    const cache = new QueryClient()
    const options = currenciesQueryOptions({ organizationId: 1n, identity: 'actor-a' })
    let requests = 0
    let error: unknown
    try {
      await cache.fetchQuery({
        ...options,
        retry: shouldRetryStoredDashboardSource,
        retryDelay: 0,
        queryFn: () => fetchCurrencies(async () => {
          requests += 1
          return Response.json({ error: 'Catalog is not accessible.' }, { status })
        }),
      })
    } catch (failure) {
      error = failure
    }
    assert.equal(requests, 1)
    assert.equal(storedDashboardSourceIssue(error)?.kind, 'denied')
    assert.equal(storedDashboardSourceIssue(error)?.status, status)
    for (const rowCount of [0, 3]) {
      assert.deepEqual(storedDashboardSourceState({ isLoading: false, error, rowCount }), {
        status: 'denied', rowCount: 0, message: 'Catalog is not accessible.',
      })
    }
    cache.clear()
  }
})

test("classifies authenticated read denial without converting it to empty data", () => {
  assert.deepEqual(
    storedDashboardSourceIssue(
      new StoredDashboardSourceQueryError("sale-orders", 403, "read denied"),
    ),
    {
      kind: "denied",
      resource: "sale-orders",
      message: "read denied",
      status: 403,
    },
  )
})

test("classifies dependency and unknown failures as query errors", () => {
  assert.deepEqual(
    storedDashboardSourceIssue(
      new StoredDashboardSourceQueryError("sale-orders", 503, "dependency unavailable"),
    ),
    {
      kind: "query-error",
      resource: "sale-orders",
      message: "dependency unavailable",
      status: 503,
    },
  )

  assert.deepEqual(storedDashboardSourceIssue(new Error("network failed")), {
    kind: "query-error",
    resource: "unknown",
    message: "network failed",
  })
})

test("does not retry denied reads and bounds dependency retries", () => {
  const denied = new StoredDashboardSourceQueryError("sale-orders", 403, "read denied")
  const unavailable = new StoredDashboardSourceQueryError(
    "sale-orders",
    503,
    "dependency unavailable",
  )

  assert.equal(shouldRetryStoredDashboardSource(0, denied), false)
  assert.equal(shouldRetryStoredDashboardSource(0, unavailable), true)
  assert.equal(shouldRetryStoredDashboardSource(1, unavailable), true)
  assert.equal(shouldRetryStoredDashboardSource(2, unavailable), false)
})
