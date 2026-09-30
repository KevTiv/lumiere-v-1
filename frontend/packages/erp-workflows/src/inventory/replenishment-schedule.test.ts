import assert from "node:assert/strict"
import test from "node:test"

import {
  captureReplenishmentScheduleSnapshot,
  observeReplenishmentSchedule,
  replenishmentScheduleState,
} from "./replenishment-schedule"

test("scheduler state distinguishes missing projection from an unscheduled rule", () => {
  assert.deepEqual(replenishmentScheduleState({ id: 7 }), {
    readable: false,
    jobId: null,
  })
  assert.deepEqual(
    replenishmentScheduleState({ id: 7, scheduledRunJobId: null }),
    { readable: true, jobId: null },
  )
})

test("schedule preflight requires the exact rule to be unscheduled", () => {
  assert.deepEqual(
    captureReplenishmentScheduleSnapshot(
      { ruleId: "7", action: "schedule" },
      [{ id: 7, scheduled_run_job_id: null }],
    ),
    { ruleId: "7", scheduledRunJobIdBefore: null },
  )
  assert.equal(
    captureReplenishmentScheduleSnapshot(
      { ruleId: "7", action: "schedule" },
      [{ id: 7, scheduledRunJobId: 41 }],
    ),
    undefined,
  )
})

test("cancel preflight requires an exact scheduled job pointer", () => {
  assert.deepEqual(
    captureReplenishmentScheduleSnapshot(
      { ruleId: "7", action: "cancel" },
      [{ id: 7, scheduledRunJobId: "41" }],
    ),
    { ruleId: "7", scheduledRunJobIdBefore: "41" },
  )
  assert.equal(
    captureReplenishmentScheduleSnapshot(
      { ruleId: "7", action: "cancel" },
      [{ id: 7, scheduledRunJobId: null }],
    ),
    undefined,
  )
})

test("schedule readback accepts only a populated pointer on the same rule", () => {
  const input = { ruleId: "7", action: "schedule" } as const
  const snapshot = { ruleId: "7", scheduledRunJobIdBefore: null }

  assert.deepEqual(
    observeReplenishmentSchedule(input, snapshot, [
      { id: 7, scheduledRunJobId: 42 },
    ]),
    {
      outcome: "applied",
      next: {
        resource: "replenishment_rule",
        id: "7",
        module: "inventory",
      },
    },
  )
  assert.deepEqual(
    observeReplenishmentSchedule(input, snapshot, [
      { id: 8, scheduledRunJobId: 42 },
    ]),
    {},
  )
})

test("cancel readback accepts only a cleared pointer and fails closed if projection disappears", () => {
  const input = { ruleId: "7", action: "cancel" } as const
  const snapshot = { ruleId: "7", scheduledRunJobIdBefore: "42" }

  assert.equal(
    observeReplenishmentSchedule(
      input,
      snapshot,
      [{ id: 7, scheduledRunJobId: null }],
    ).outcome,
    "applied",
  )
  assert.deepEqual(
    observeReplenishmentSchedule(input, snapshot, [{ id: 7 }]),
    {},
  )
})
