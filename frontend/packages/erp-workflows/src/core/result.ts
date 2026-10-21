import type { ErpRecordRef } from "./record-ref"

/**
 * `applied`: the intended canonical effect is confirmed, not proof that this invocation newly
 * created it. `approval_pending`: the command was accepted but is
 * waiting on an approval task, so canonical state has not changed yet.
 */
export type WorkflowOutcome = "applied" | "approval_pending"

export interface WorkflowResult {
  outcome: WorkflowOutcome
  /** Transport observation, independent of canonical effect certainty. */
  dispatch?: "acknowledged" | "ambiguous"
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
    ...(results.some((r) => r.dispatch === "ambiguous")
      ? { dispatch: "ambiguous" as const }
      : results.some((r) => r.dispatch === "acknowledged")
        ? { dispatch: "acknowledged" as const }
        : {}),
    affectedResources: [...new Set(results.flatMap((r) => r.affectedResources))],
    createdRecords: created.length > 0 ? created : undefined,
    next: last?.next,
  }
}
