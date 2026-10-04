import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveReportRunEffect,
  scheduledReportRunCount,
  type ScheduledReportRunProjection,
} from "./report-run-effect"

const row = (
  id: bigint,
  organizationId: bigint,
  runCount: number,
  lastRun: unknown = "2026-09-30T06:00:00Z",
): ScheduledReportRunProjection => ({ id, organizationId, runCount, lastRun })

test("reads the run count of the exact schedule", () => {
  assert.equal(scheduledReportRunCount([row(4n, 1n, 9), row(5n, 1n, 2)], 1n, 5n), 2)
  assert.equal(scheduledReportRunCount([row(5n, 2n, 2)], 1n, 5n), null)
  assert.equal(scheduledReportRunCount([], 1n, 5n), null)
})

test("resolves when run_count advanced by exactly one and last_run is stamped", () => {
  assert.deepEqual(resolveReportRunEffect([row(4n, 1n, 9), row(5n, 1n, 3)], 1n, 5n, 2), {
    resource: "scheduled-reports",
    id: "5",
  })
})

test("accepts snake_case projection rows", () => {
  assert.deepEqual(
    resolveReportRunEffect([{ id: "5", organization_id: "1", run_count: "3", last_run: "x" }], 1n, 5n, 2),
    { resource: "scheduled-reports", id: "5" },
  )
})

test("does not resolve an unchanged, over-advanced or unstamped run", () => {
  assert.equal(resolveReportRunEffect([row(5n, 1n, 2)], 1n, 5n, 2), null)
  assert.equal(resolveReportRunEffect([row(5n, 1n, 4)], 1n, 5n, 2), null)
  assert.equal(resolveReportRunEffect([row(5n, 1n, 3, null)], 1n, 5n, 2), null)
})

test("does not resolve a missing or foreign-organization schedule", () => {
  assert.equal(resolveReportRunEffect([row(6n, 1n, 3)], 1n, 5n, 2), null)
  assert.equal(resolveReportRunEffect([row(5n, 2n, 3)], 1n, 5n, 2), null)
})

test("throws on duplicate schedule ids", () => {
  assert.throws(
    () => resolveReportRunEffect([row(5n, 1n, 3), row(5n, 1n, 3)], 1n, 5n, 2),
    AmbiguousOperationEffectError,
  )
})
