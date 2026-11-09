import {
  workActionsForActor,
  workStatus,
  type WorkTaskRow,
} from "@lumiere/query-hooks/hooks/work-board-model"

type WorkflowWorkGroup = "blocked" | "active" | "resolved"

const WORKFLOW_GROUPS = ["blocked", "active", "resolved"] as const

function workflowWorkGroup(row: WorkTaskRow): WorkflowWorkGroup {
  switch (workStatus(row)) {
    case "Invalidated":
    case "Cancelled":
    case "Rejected":
      return "blocked"
    case "Open":
    case "Claimed":
      return "active"
    default:
      return "resolved"
  }
}

export function groupWorkflowWork(rows: readonly WorkTaskRow[]) {
  const groups: Record<WorkflowWorkGroup, WorkTaskRow[]> = {
    blocked: [],
    active: [],
    resolved: [],
  }
  for (const row of rows) groups[workflowWorkGroup(row)].push(row)
  return WORKFLOW_GROUPS.map((id) => ({ id, rows: groups[id] })).filter(
    (group) => group.rows.length > 0,
  )
}

export function workflowNextStep(row: WorkTaskRow) {
  const actions = workActionsForActor(row)
  if (actions.includes("resubmit")) return "resubmit"
  if (actions.includes("claim")) return "claim"
  if (actions.length > 0) return "review"
  if (
    row.actingForOptions?.some(
      (option) => workActionsForActor(row, option.identityHex).length > 0,
    )
  )
    return "chooseActor"
  if (workflowWorkGroup(row) === "blocked") return "inspect"
  if (workflowWorkGroup(row) === "active") return "wait"
  return "view"
}

/** Sales and Purchasing detail routes have the existing Discussion composer. */
export function recordFollowupHref(
  model?: string,
  id?: number,
): string | undefined {
  if (!Number.isSafeInteger(id) || !id || id < 1) return undefined
  if (model === "purchase_order")
    return `/purchasing/orders/${id}?tab=discussion`
  if (model === "sale_order") return `/sales/orders/${id}?tab=discussion`
}
