import assert from "node:assert/strict"
import test from "node:test"
import { HttpResponseError } from "@lumiere/api-client/response-error"

import {
  StoredDashboardQueryError,
  storedDashboardSourceState,
  storedDashboardSourceIssue,
  shouldRetryStoredDashboardSource,
} from "./stored-dashboard-source-state"

test("keeps ready and empty dashboard sources distinct", () => {
  assert.deepEqual(storedDashboardSourceState({ isLoading: false, error: null, rowCount: 2 }), {
    status: "ready",
    rowCount: 2,
  })
  assert.deepEqual(storedDashboardSourceState({ isLoading: false, error: null, rowCount: 0 }), {
    status: "empty",
    rowCount: 0,
  })
})

test("shared HTTP failures preserve denial and bounded retry semantics without interpreting messages", () => {
  const denied = new HttpResponseError(403, 'Service temporarily unavailable')
  const unavailable = new HttpResponseError(503, 'Forbidden')
  assert.equal(storedDashboardSourceState({ isLoading: false, error: denied, rowCount: 3 }).status, 'denied')
  assert.equal(shouldRetryStoredDashboardSource(0, denied), false)
  assert.equal(storedDashboardSourceState({ isLoading: false, error: unavailable, rowCount: 0 }).status, 'unavailable')
  assert.equal(shouldRetryStoredDashboardSource(0, unavailable), true)
  assert.equal(shouldRetryStoredDashboardSource(2, unavailable), false)
  assert.equal(storedDashboardSourceIssue(new Error('403 Forbidden'))?.kind, 'query-error')
  assert.equal(storedDashboardSourceState({ isLoading: false, error: new Error('403 Forbidden'), rowCount: 0 }).status, 'unavailable')
})

test("classifies authorization failures as denied and other failures as unavailable", () => {
  assert.equal(
    storedDashboardSourceState({
      isLoading: false,
      error: new StoredDashboardQueryError(403, "denied"),
      rowCount: 0,
    }).status,
    "denied",
  )
  assert.equal(
    storedDashboardSourceState({ isLoading: false, error: new Error("offline"), rowCount: 0 }).status,
    "unavailable",
  )
})

test("classifies stale rows with a refresh failure as partial", () => {
  assert.deepEqual(
    storedDashboardSourceState({ isLoading: false, error: new Error("refresh failed"), rowCount: 3 }),
    { status: "partial", rowCount: 3, message: "refresh failed" },
  )
})
