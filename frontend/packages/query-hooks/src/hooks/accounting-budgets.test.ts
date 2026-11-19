import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient } from "@tanstack/react-query"
import { invalidateBudgetQueries } from "./accounting/budgets"
import { typedStdbQueryKey } from "./stdb"

test("budget mutations invalidate company-scoped typed reads for the affected organization", () => {
  const qc = new QueryClient()
  const affected = ["budgets", "budget-lines", "budget-posts"].map((resource) =>
    typedStdbQueryKey(resource, 7, 42),
  )
  const unaffected = [
    typedStdbQueryKey("budgets", 8, 43),
    typedStdbQueryKey("account-accounts", 7, 42),
  ]
  try {
    for (const key of [...affected, ...unaffected]) qc.setQueryData(key, [])

    invalidateBudgetQueries(qc, 7)

    for (const key of affected) assert.equal(qc.getQueryState(key)?.isInvalidated, true)
    for (const key of unaffected) assert.equal(qc.getQueryState(key)?.isInvalidated, false)
  } finally {
    qc.clear()
  }
})
