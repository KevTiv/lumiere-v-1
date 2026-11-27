import type { TFunction } from "i18next"
import { z } from "zod"
import type { ChatImportTask } from "./chat-import-task"
import type { ImportTaskView } from "./import-task-navigation"
import type { ImportWorkflow } from "./import-workflow"

const status = z.enum(["queued", "running", "verified", "partial", "failed", "blocked"])
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const projection = z.object({
  runs: z.array(z.object({
    id: z.string().min(1),
    taskId: z.string().regex(/^[0-9a-f]{32}$/),
    status,
    rowCount: count,
    verifiedRowCount: count,
    failedRows: count.default(0),
    heldRows: count.default(0),
  }).refine(run => run.verifiedRowCount + run.failedRows + run.heldRows <= run.rowCount)),
  more: z.boolean().default(false),
  coverage: z.object({
    reviewRowCount: count,
    verifiedRowCount: count,
    excludedRowCount: count.default(0),
    complete: z.boolean(),
  }).refine(({ reviewRowCount, verifiedRowCount, excludedRowCount, complete }) =>
    verifiedRowCount + excludedRowCount <= reviewRowCount
    && (!complete || (verifiedRowCount > 0 && verifiedRowCount + excludedRowCount === reviewRowCount))),
})
export type SavedImportRuns = z.infer<typeof projection>
export const savedImportQueues = ["needs-me", "with-reviewer", "running", "done"] as const
export type SavedImportQueue = typeof savedImportQueues[number]
export type SavedImportAction = ImportTaskView | "check" | "handoff" | "prepare" | "resume"

export function parseSavedImportRuns(payload: unknown, taskId: string): SavedImportRuns {
  const result = projection.parse(payload)
  const { runs, coverage, more } = result
  if (runs.some(run => run.taskId !== taskId) || new Set(runs.map(run => run.id)).size !== runs.length ||
      (!more && coverage.verifiedRowCount > runs.reduce((sum, run) => sum + run.verifiedRowCount, 0))) {
    throw new Error("The saved runs did not match this import.")
  }
  return result
}

export function savedImportOperatorState({
  task, progress, workflow, pendingAnswer = false, runCheckFailed = false, canPrepare = false, nextView = "sources",
}: {
  task: ChatImportTask
  progress?: SavedImportRuns
  workflow?: ImportWorkflow
  pendingAnswer?: boolean
  runCheckFailed?: boolean
  canPrepare?: boolean
  nextView?: ImportTaskView
}): { queue: SavedImportQueue; action: SavedImportAction } {
  const pending = task.reviews.some(review => review.pending > 0)
  const runs = progress?.runs ?? []
  if (runs.some(run => run.status === "queued" || run.status === "running")) return { queue: "running", action: "check" }
  if (pendingAnswer) return { queue: "needs-me", action: "check" }
  if (!pending && progress?.coverage.complete) return { queue: "done", action: "results" }
  if (task.handoff?.recipient && !task.handoff.canReview) return { queue: "with-reviewer", action: "handoff" }
  const unresolved = runCheckFailed || runs.some(run => ["partial", "failed", "blocked"].includes(run.status)) ||
    workflow?.proposals.some(proposal => ["executing", "approved", "blocked"].includes(proposal.status)) ||
    workflow?.nativeResults.some(result => result.state === "awaiting_receipt" || result.receipt?.status === "pending")
  if (unresolved) return { queue: "needs-me", action: "check" }
  if (task.status === "inspection_ready" && task.decision.selectedOptionId === "inspect_only" && !pending) {
    return { queue: "done", action: canPrepare ? "prepare" : nextView }
  }
  if (canPrepare) return { queue: "needs-me", action: "prepare" }
  if (task.status === "saved") return { queue: "needs-me", action: "resume" }
  return { queue: "needs-me", action: pending && task.status === "needs_review" ? "decisions" : nextView }
}

export function savedImportQueueLabel(t: TFunction, queue: SavedImportQueue) {
  return {
    "needs-me": t("settings.importOperator.needsMe"),
    "with-reviewer": t("settings.importOperator.withReviewer"),
    running: t("settings.importOperator.running"),
    done: t("settings.importOperator.done"),
  }[queue]
}

export function savedImportGoal(t: TFunction, task: ChatImportTask, workflow?: ImportWorkflow) {
  if (task.decision.selectedOptionId === "inspect_only") return t("settings.importOperator.inspect")
  const targets = new Set(task.reviews.map(review => review.targetEntity))
  if (targets.size > 1) return t("settings.importOperator.multiple")
  if (workflow?.proposals.length) return t("settings.importOperator.journals")
  switch (targets.values().next().value) {
    case "shop_sales":
    case "shop_sale": return t("settings.importOperator.shopSales")
    case "product": return t("settings.importOperator.products")
    case "contact": return t("settings.importOperator.contacts")
    case "stock_location": return t("settings.importOperator.locations")
    case "farm_event": return t("settings.importOperator.farmEvents")
    default: return t("settings.importOperator.goal", { file: task.files[0]?.fileName })
  }
}
