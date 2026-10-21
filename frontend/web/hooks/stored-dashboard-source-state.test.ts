import assert from "node:assert/strict"
import test from "node:test"

import {
  StoredDashboardQueryError,
  storedDashboardSourceState,
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
