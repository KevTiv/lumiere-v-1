import assert from "node:assert/strict"
import { test } from "node:test"
import type { QueryResourceState } from "@lumiere/api-client"
import { combinedResourceStatus, overviewResourceStatus, resourceStatusLabel } from "./resource-state"

test("denied SSR resources survive pending hydration and client failure", () => {
  const denied: QueryResourceState<unknown> = { status: "denied", rows: [], message: "Forbidden" }
  assert.equal(overviewResourceStatus({ status: "pending" }, denied), "denied")
  assert.equal(overviewResourceStatus({ status: "error" }, denied), "denied")
  assert.equal(resourceStatusLabel("denied"), "Access denied")
})

test("successful canonical client read supersedes denied or unavailable SSR", () => {
  assert.equal(overviewResourceStatus({ status: "success" }, { status: "denied", rows: [], message: "Forbidden" }), "ready")
  assert.equal(overviewResourceStatus({ status: "success" }, { status: "unavailable", rows: [], message: "Offline" }), "ready")
  assert.equal(resourceStatusLabel("ready"), undefined)
  assert.equal(resourceStatusLabel("empty"), undefined)
})

test("client errors never become successful zero metrics, including stale seeded data", () => {
  assert.equal(overviewResourceStatus({ status: "error" }), "unavailable")
  assert.equal(overviewResourceStatus({ status: "error" }, { status: "ready", rows: [{ id: 1 }] }), "unavailable")
  assert.equal(resourceStatusLabel("unavailable"), "Unavailable")
  assert.equal(overviewResourceStatus({ status: "pending" }), "loading")
})

test("combined queues require all dependencies before a numeric count is visible", () => {
  assert.equal(combinedResourceStatus("ready", "empty"), "ready")
  assert.equal(combinedResourceStatus("ready", "denied"), "denied")
  assert.equal(combinedResourceStatus("ready", "unavailable"), "unavailable")
  assert.equal(combinedResourceStatus("ready", "loading"), "loading")
  assert.equal(combinedResourceStatus("loading", "denied", "unavailable"), "denied")
})
