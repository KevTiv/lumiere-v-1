import assert from "node:assert/strict"
import { test } from "node:test"
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { resolveAllowedActiveCompanyId } from "@lumiere/erp-session"

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
