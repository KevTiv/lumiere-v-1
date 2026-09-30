import {
  firstOwnedKey,
  type RowValueMap,
} from "@lumiere/erp-shared/row-values"

import { recordRef } from "../core/record-ref"
import { rowId } from "../core/row"
import type { ObservedTransition } from "../core/transition"
import { defineWorkflow } from "../core/workflow"

export const replenishmentScheduleWorkflow = defineWorkflow({
  id: "inventory.replenishment.schedule",
  resource: "replenishment_rule",
  module: "inventory",
})

export const replenishmentScheduleCancelWorkflow = defineWorkflow({
  id: "inventory.replenishment.schedule-cancel",
  resource: "replenishment_rule",
  module: "inventory",
})

export const REPLENISHMENT_SCHEDULE_AFFECTS = ["replenishment-rules"] as const

export type ReplenishmentScheduleAction = "schedule" | "cancel"

export interface ReplenishmentScheduleInput {
  ruleId: string
  action: ReplenishmentScheduleAction
}

export interface ReplenishmentScheduleSnapshot {
  ruleId: string
  scheduledRunJobIdBefore: string | null
}

export type ReplenishmentScheduleState =
  | { readable: false; jobId: null }
  | { readable: true; jobId: string | null }

const hasOwn = (row: RowValueMap, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(row, key)

/**
 * Read the public scheduler pointer without conflating a missing projection
 * with an intentionally empty Option. A missing field must fail closed.
 */
export function replenishmentScheduleState(
  row: RowValueMap,
): ReplenishmentScheduleState {
  const camel = "scheduledRunJobId"
  const snake = "scheduled_run_job_id"
  if (!hasOwn(row, camel) && !hasOwn(row, snake)) {
    return { readable: false, jobId: null }
  }

  const raw = firstOwnedKey(row, camel, snake)
  if (raw === null || raw === undefined) {
    return { readable: true, jobId: null }
  }

  return { readable: true, jobId: String(raw) }
}

/**
 * Preflight against the exact replenishment rule. Scheduling requires no
 * pending job; cancellation requires the exact inverse. This makes stale UI
 * state fail before dispatch while the reducer remains authoritative.
 */
export function captureReplenishmentScheduleSnapshot(
  input: ReplenishmentScheduleInput,
  rows: readonly RowValueMap[],
): ReplenishmentScheduleSnapshot | undefined {
  const rule = rows.find((row) => rowId(row) === input.ruleId)
  if (!rule) return undefined

  const state = replenishmentScheduleState(rule)
  if (!state.readable) return undefined
  if (input.action === "schedule" && state.jobId !== null) return undefined
  if (input.action === "cancel" && state.jobId === null) return undefined

  return {
    ruleId: input.ruleId,
    scheduledRunJobIdBefore: state.jobId,
  }
}

/** Verify the exact rule's public scheduler pointer converged after dispatch. */
export function observeReplenishmentSchedule(
  input: ReplenishmentScheduleInput,
  snapshot: ReplenishmentScheduleSnapshot,
  rows: readonly RowValueMap[],
): ObservedTransition {
  const rule = rows.find((row) => rowId(row) === snapshot.ruleId)
  if (!rule) return {}

  const state = replenishmentScheduleState(rule)
  if (!state.readable) return {}

  const converged =
    input.action === "schedule" ? state.jobId !== null : state.jobId === null
  if (!converged) return {}

  return {
    outcome: "applied",
    next: recordRef("replenishment_rule", snapshot.ruleId, "inventory"),
  }
}
