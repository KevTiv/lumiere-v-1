import assert from "node:assert/strict"
import test from "node:test"

import {
  StoredDashboardSourceQueryError,
  shouldRetryStoredDashboardSource,
  storedDashboardSourceIssue,
} from "./stored-dashboard-source-state"

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
