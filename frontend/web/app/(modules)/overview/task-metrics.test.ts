import assert from "node:assert/strict"
import { test } from "node:test"
import { overviewTaskMetrics } from "./task-metrics"

const nowMs = Date.parse("2026-11-10T12:00:00Z")
const past = { microsSinceUnixEpoch: BigInt(Date.parse("2026-11-09T12:00:00Z")) * 1000n }
const future = { microsSinceUnixEpoch: String(BigInt(Date.parse("2026-11-11T12:00:00Z")) * 1000n) }

test("Overview counts overdue tasks from the backend's normalized timestamp object", () => {
  assert.deepEqual(overviewTaskMetrics([
    { isClosed: false, dateDeadline: past },
    { isClosed: false, dateDeadline: future },
    { isClosed: false, dateDeadline: null },
    { isClosed: true, dateDeadline: past },
  ], "ready", nowMs), { openCount: 3, overdueCount: 1 })
})

test("no open tasks and an explicit absent deadline yield real zeros after a successful read", () => {
  assert.deepEqual(overviewTaskMetrics([], "ready", nowMs), { openCount: 0, overdueCount: 0 })
  assert.deepEqual(overviewTaskMetrics([], "empty", nowMs), { openCount: 0, overdueCount: 0 })
  assert.deepEqual(overviewTaskMetrics([{ isClosed: true }], "ready", nowMs), { openCount: 0, overdueCount: 0 })
  assert.deepEqual(overviewTaskMetrics([{ isClosed: false, dateDeadline: null }], "ready", nowMs), { openCount: 1, overdueCount: 0 })
})

test("loading, denied or unavailable sources with cached rows never expose numeric counts", () => {
  for (const status of ["loading", "denied", "unavailable"] as const) {
    for (const rows of [[], [{ isClosed: false, dateDeadline: past }]]) {
      assert.deepEqual(overviewTaskMetrics(rows, status, nowMs), { openCount: null, overdueCount: null })
    }
  }
  assert.deepEqual(overviewTaskMetrics([{ isClosed: false, dateDeadline: past }], "empty", nowMs), { openCount: null, overdueCount: null })
})

test("redacted or invalid closure flags invalidate both task counts", () => {
  for (const isClosed of [undefined, null, "false", 0]) {
    assert.deepEqual(overviewTaskMetrics([{ isClosed, dateDeadline: past }], "ready", nowMs), { openCount: null, overdueCount: null })
  }
})

test("missing, redacted or invalid open-task deadlines withhold overdue while preserving known open count", () => {
  const rows = [
    { isClosed: false },
    ...[undefined, "", "not-a-date", { microsSinceUnixEpoch: "not-a-number" }, { microsSinceUnixEpoch: 1e30 }, new Date("invalid")]
      .map((dateDeadline) => ({ isClosed: false, dateDeadline })),
  ]
  for (const row of rows) {
    assert.deepEqual(overviewTaskMetrics([{ isClosed: false, dateDeadline: past }, row], "ready", nowMs), { openCount: 2, overdueCount: null })
  }
})

test("supported ISO/snake-case fields and exact deadline boundaries retain their meaning", () => {
  assert.deepEqual(overviewTaskMetrics([
    { is_closed: false, date_deadline: "2026-11-09T12:00:00Z" },
    { isClosed: false, dateDeadline: new Date(nowMs) },
    { isClosed: false, dateDeadline: { some: null } },
  ], "ready", nowMs), { openCount: 3, overdueCount: 1 })
})


test("typed microseconds retain their declared unit for old dates, epoch and pre-epoch", () => {
  const early = BigInt(Date.parse("1972-01-01T00:00:00Z")) * 1000n
  for (const dateDeadline of [
    { microsSinceUnixEpoch: early },
    { micros_since_unix_epoch: String(early) },
    { __timestamp_micros_since_unix_epoch__: early },
    { microsSinceUnixEpoch: 0 },
    { microsSinceUnixEpoch: -1000 },
  ]) {
    assert.deepEqual(overviewTaskMetrics([{ isClosed: false, dateDeadline }], "ready", nowMs), { openCount: 1, overdueCount: 1 })
  }
})

test("invalid ISO calendar dates cannot normalize into an apparently overdue deadline", () => {
  for (const dateDeadline of ["2026-02-30", "2026-02-30T00:00:00Z", "2026-02-30T12:00:00+02:00"]) {
    assert.deepEqual(overviewTaskMetrics([{ isClosed: false, dateDeadline }], "ready", nowMs), { openCount: 1, overdueCount: null })
  }
})
