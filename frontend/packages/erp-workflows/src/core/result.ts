import type { ErpRecordRef } from "./record-ref"

/**
 * `applied`: the transition took effect. `approval_pending`: the command was accepted but is
 * waiting on an approval task, so canonical state has not changed yet.
 */
export type WorkflowOutcome = "applied" | "approval_pending"

export interface WorkflowResult {
  outcome: WorkflowOutcome
  /** Query resources (`sale-orders`, ...) whose canonical state this transition touched. */
  affectedResources: string[]
  createdRecords?: ErpRecordRef[]
  /** Where a user most plausibly continues (opened after success when the surface navigates). */
  next?: ErpRecordRef
}

export function mergeWorkflowResults(results: readonly WorkflowResult[]): WorkflowResult {
  const created = results.flatMap((r) => r.createdRecords ?? [])
  const last = results.at(-1)
  return {
    outcome: results.some((r) => r.outcome === "approval_pending") ? "approval_pending" : "applied",
    affectedResources: [...new Set(results.flatMap((r) => r.affectedResources))],
    createdRecords: created.length > 0 ? created : undefined,
    next: last?.next,
  }
}
