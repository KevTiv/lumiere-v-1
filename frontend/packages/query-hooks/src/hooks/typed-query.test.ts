import assert from "node:assert/strict"
import { test } from "node:test"
import { QueryClient, type QueryKey } from "@tanstack/react-query"
import { resolveAllowedActiveCompanyId } from "@lumiere/erp-session"
import { SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS } from "@lumiere/stdb/subscriptions"

import {
  invalidateStdbQueryResources,
  stdbQueryKey,
  typedStdbQueryKey,
} from "./stdb"

test("typed resource keys are company-scoped and isolated from direct row cache keys", () => {
  assert.deepEqual(typedStdbQueryKey("account-journals", 7n, 42), [
    "typed-stdb",
    "account-journals",
    "7",
    "company",
    42,
  ])
  assert.notDeepEqual(
    typedStdbQueryKey("account-journals", 7n, 42),
    stdbQueryKey("account-journals", 7n, 42),
  )
})

test("a fresh session resolves its first authorized company for typed reads", () => {
  assert.equal(resolveAllowedActiveCompanyId(null, [42]), 42)
  assert.equal(resolveAllowedActiveCompanyId(7, [42, 7]), 7)
  assert.equal(resolveAllowedActiveCompanyId(99, [42, 7]), 42)
})

test("resource invalidation always includes the typed HTTP namespace", () => {
  const invalidated: QueryKey[] = []
  const queryClient = {
    invalidateQueries: ({ queryKey }: { queryKey?: QueryKey }) => {
      if (queryKey) invalidated.push(queryKey)
      return Promise.resolve()
    },
  } as QueryClient

  invalidateStdbQueryResources(queryClient, 7n, ["account-taxes"])

  assert.deepEqual(invalidated[0], ["typed-stdb", "account-taxes", "7"])
})

test("subscription handoffs subscribe to all canonical relation resources", () => {
  for (const resource of ["subscription-billing-runs", "account-moves", "account-payments"] as const) {
    assert.ok(SUBSCRIPTIONS_WORKSPACE_RESOURCE_KEYS.includes(resource))
  }
})

test("payment invalidation reaches typed company caches without crossing organizations", () => {
  const queryClient = new QueryClient()
  const companyPaymentKey = typedStdbQueryKey("account-payments", 7n, 42)
  const otherOrgPaymentKey = typedStdbQueryKey("account-payments", 8n, 42)
  queryClient.setQueryData(companyPaymentKey, [])
  queryClient.setQueryData(otherOrgPaymentKey, [])

  invalidateStdbQueryResources(queryClient, 7n, ["account-payments"])

  assert.equal(queryClient.getQueryState(companyPaymentKey)?.isInvalidated, true)
  assert.equal(queryClient.getQueryState(otherOrgPaymentKey)?.isInvalidated, false)
  queryClient.clear()
})
