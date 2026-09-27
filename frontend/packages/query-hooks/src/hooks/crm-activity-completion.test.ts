import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveCompletedActivityEffect,
  type ActivityCompletionProjection,
} from "./crm-activity-completion"

const row = (
  id: bigint,
  organizationId: bigint,
  state: string,
  isDone: boolean,
): ActivityCompletionProjection => ({ id, organizationId, state, isDone })

test("returns the canonical ref for the exact completed activity", () => {
  assert.deepEqual(
    resolveCompletedActivityEffect([row(4n, 1n, "planned", false), row(5n, 1n, "done", true)], 1n, 5n),
    { resource: "activities", id: "5" },
  )
})

test("accepts snake_case projection rows", () => {
  assert.deepEqual(
    resolveCompletedActivityEffect([{ id: "5", organization_id: "1", state: "done", is_done: true }], 1n, 5n),
    { resource: "activities", id: "5" },
  )
})

test("returns null while the activity is still open", () => {
  assert.equal(resolveCompletedActivityEffect([row(5n, 1n, "planned", false)], 1n, 5n), null)
  assert.equal(resolveCompletedActivityEffect([row(5n, 1n, "done", false)], 1n, 5n), null)
})

test("returns null for a missing or foreign-organization activity", () => {
  assert.equal(resolveCompletedActivityEffect([row(6n, 1n, "done", true)], 1n, 5n), null)
  assert.equal(resolveCompletedActivityEffect([row(5n, 2n, "done", true)], 1n, 5n), null)
})

test("throws on duplicate activity ids", () => {
  assert.throws(
    () => resolveCompletedActivityEffect([row(5n, 1n, "done", true), row(5n, 1n, "done", true)], 1n, 5n),
    AmbiguousOperationEffectError,
  )
})
