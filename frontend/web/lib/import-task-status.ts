import { z } from "zod"
import type {
  ChatImportPostingStatus,
  ChatImportTaskStatus,
} from "@lumiere/ui/lib/import-task-status"
import type { ChatMessageSourceRef } from "@lumiere/ui/lib/ai-chat-types"
import { importTaskStatusIsCurrent } from "@lumiere/ui/lib/import-task-status"
import { parseChatImportTask, type ChatImportScope } from "./chat-import-task"
import { readImportWorkflow, type WorkflowFetch } from "./import-workflow"

const id = z.string().regex(/^[1-9]\d{0,19}$/)
const count = z.number().int().min(0).max(1_000_000_000)
const decimal = z.string().regex(/^\d{1,20}(?:\.\d{1,6})?$/)
const timestamp = z.string().datetime({ offset: true })
const taskIdSchema = z.string().regex(/^[a-f0-9]{32}$/)
const nativeResultSchema = z
  .object({
    requestId: z.string().regex(/^[a-f0-9]{32}$/),
    entity: z.enum(["product", "contact", "stock_location"]),
    state: z.enum(["awaiting_receipt", "receipt_available"]),
    verification: z.literal("native_receipt_only"),
    receipt: z
      .object({
        jobId: id,
        status: z.enum([
          "pending",
          "success",
          "partial",
          "failed",
          "rolled_back",
        ]),
        totalRows: count,
        rowsImported: count,
        errorRows: count,
      })
      .nullable(),
  })
  .superRefine((result, ctx) => {
    const receipt = result.receipt
    if (
      (result.state === "receipt_available") !== (receipt !== null) ||
      (receipt &&
        (receipt.rowsImported > receipt.totalRows ||
          receipt.errorRows > receipt.totalRows))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The saved native job receipt is inconsistent.",
      })
    }
  })
function amountUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".")
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))
}
const statusSchema = z
  .object({
    taskId: taskIdSchema,
    companyId: id,
    organizationId: id,
    readAt: timestamp,
    preparationStatus: z.enum([
      "awaiting_decision",
      "saved",
      "needs_review",
      "inspection_ready",
      "failed",
    ]),
    fileNames: z.array(z.string().min(1).max(255)).min(1).max(20).optional(),
    sourceRows: z.object({
      total: count,
      ready: count,
      held: count,
      excluded: count,
    }),
    proposalCount: count,
    proposals: z
      .array(
        z.object({
          id,
          status: z.enum([
            "prepared",
            "approved",
            "executing",
            "verified",
            "blocked",
          ]),
          phase: z.enum([
            "not_started",
            "headers",
            "lines",
            "verification",
            "complete",
          ]),
          expectedRecords: count.max(200),
          heldRecords: count.max(200).optional(),
          verifiedResult: z
            .object({
              recordCount: count.max(200),
              lineCount: count.max(400),
              totalDebit: decimal,
              totalCredit: decimal,
              currencyId: id,
              postedCount: z.literal(0),
              verifiedAt: timestamp,
              records: z
                .array(
                  z.object({
                    id,
                    reference: z.string().min(1).max(250),
                  }),
                )
                .max(200)
                .optional(),
            })
            .nullable(),
        }),
      )
      .max(10),
    nativeResults: z.array(nativeResultSchema).max(20).default([]),
    nativeResultsMore: z.boolean().default(false),
  })
  .superRefine((status, ctx) => {
    const issue = () =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The saved import status is inconsistent.",
      })
    const rows = status.sourceRows
    if (
      rows.total !== rows.ready + rows.held + rows.excluded ||
      status.proposals.length > status.proposalCount ||
      new Set(status.proposals.map((proposal) => proposal.id)).size !==
        status.proposals.length ||
      new Set(status.nativeResults.map((result) => result.requestId)).size !==
        status.nativeResults.length
    )
      issue()
    for (const proposal of status.proposals) {
      const result = proposal.verifiedResult
      if (
        (proposal.status === "verified") !== (result !== null) ||
        (proposal.status === "verified") !== (proposal.phase === "complete")
      )
        issue()
      if (
        result &&
        (result.recordCount !== proposal.expectedRecords ||
          result.lineCount !== result.recordCount * 2 ||
          amountUnits(result.totalDebit) !== amountUnits(result.totalCredit) ||
          (result.records &&
            (result.records.length !== result.recordCount ||
              new Set(result.records.map((record) => record.id)).size !==
                result.recordCount)))
      )
        issue()
    }
  })

export function parseImportTaskStatuses(
  raw: unknown,
): ChatImportTaskStatus[] | undefined {
  return raw === undefined ? undefined : z.array(statusSchema).max(4).parse(raw)
}

export function parseStoredImportTaskIds(
  metadata?: string | null,
  sources?: readonly ChatMessageSourceRef[],
): string[] | undefined {
  if (metadata) {
    try {
      const parsed = z
        .object({ importTaskIds: z.array(taskIdSchema).max(4) })
        .safeParse(JSON.parse(metadata))
      if (parsed.success) return [...new Set(parsed.data.importTaskIds)]
    } catch {
      // Legacy metadata is optional; the original citations still identify the task.
    }
  }
  const legacy = new Set<string>()
  for (const source of sources ?? []) {
    if (
      source?.kind !== "live" ||
      source.trust !== "authoritative" ||
      source.entity_type !== "import_task" ||
      source.source_kind !== "import_task"
    )
      continue
    const id = taskIdSchema.safeParse(source.entity_id)
    if (id.success && id.data === source.source_key) legacy.add(id.data)
    if (legacy.size === 4) break
  }
  return legacy.size ? [...legacy] : undefined
}

/** Reopen a saved reference through the actor-scoped task and workflow reads. */
export async function readChatImportTaskStatus(
  fetcher: WorkflowFetch,
  scope: ChatImportScope,
  taskId: string,
  signal?: AbortSignal,
): Promise<ChatImportTaskStatus> {
  taskIdSchema.parse(taskId)
  const read: WorkflowFetch = (url, options) =>
    fetcher(url, { ...options, signal })
  const response = await read(
    `/api/import-tasks/${taskId}?companyId=${scope.companyId}`,
    { cache: "no-store" },
  )
  if (!response.ok) throw new Error("Saved import is unavailable")
  const body = await response.json()
  if (body?.organizationId !== String(scope.organizationId)) {
    throw new Error("Saved import organization changed")
  }
  const task = parseChatImportTask(body, scope, taskId)
  const workflow = await readImportWorkflow(read, { ...scope, taskId })
  const sourceRows = task.reviews.reduce(
    (sum, review) => ({
      total: sum.total + review.total,
      ready: sum.ready + review.confirmed,
      held: sum.held + review.pending,
      excluded: sum.excluded + review.excluded,
    }),
    { total: 0, ready: 0, held: 0, excluded: 0 },
  )
  return statusSchema.parse({
    taskId,
    organizationId: workflow.organizationId,
    companyId: workflow.companyId,
    readAt: new Date().toISOString(),
    preparationStatus: task.status,
    fileNames: task.files.map((file) => file.fileName),
    sourceRows,
    proposalCount: workflow.proposals.length,
    proposals: workflow.proposals.slice(0, 10).map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      phase: proposal.execution.phase,
      expectedRecords: proposal.summary.recordCount,
      heldRecords: proposal.summary.blockedCount,
      verifiedResult: proposal.result && {
        ...proposal.result,
        records: proposal.result.recordIds.map((id, index) => ({
          id,
          reference: proposal.entries[index]!.reference,
        })),
      },
    })),
    nativeResults: workflow.nativeResults,
    nativeResultsMore: workflow.nativeResultsMore,
  })
}

const postingSchema = z.object({
  proposalId: id,
  taskId: taskIdSchema,
  companyId: id,
  organizationId: id,
  recordCount: count.max(200),
  draftCount: count.max(200),
  postedCount: count.max(200),
  otherCount: count.max(200),
  unavailableCount: count.max(200),
  checkedAt: timestamp,
})

export async function readChatImportPostingStatus(
  fetcher: WorkflowFetch,
  task: Pick<ChatImportTaskStatus, "taskId" | "companyId" | "organizationId">,
  proposal: { id: string; expectedRecords: number },
  signal?: AbortSignal,
): Promise<ChatImportPostingStatus> {
  const taskId = taskIdSchema.parse(task.taskId)
  const proposalId = id.parse(proposal.id)
  const companyId = id.parse(task.companyId)
  const response = await fetcher(
    `/api/import-tasks/${taskId}/workflow/proposals/${proposalId}/posting-status?companyId=${companyId}`,
    { cache: "no-store", signal },
  )
  if (!response.ok) throw new Error("Current posting state is unavailable")
  const result = postingSchema.parse(await response.json())
  const { recordCount, draftCount, postedCount, otherCount, unavailableCount } =
    result
  if (
    result.taskId !== taskId ||
    result.proposalId !== proposalId ||
    result.companyId !== companyId ||
    result.organizationId !== task.organizationId ||
    recordCount !== proposal.expectedRecords ||
    recordCount !== draftCount + postedCount + otherCount + unavailableCount
  ) {
    throw new Error("Posting readback does not match the saved journal entries")
  }
  return {
    proposalId,
    recordCount,
    draftCount,
    postedCount,
    otherCount,
    unavailableCount,
  }
}

/** A card may only accompany the task selectors dispatched in this exact turn. */
export function scopedImportTaskStatuses(
  statuses: readonly ChatImportTaskStatus[] | undefined,
  scope: {
    organizationId: number
    companyId: number
    taskIds: readonly string[]
  },
  now = Date.now(),
): ChatImportTaskStatus[] {
  return (statuses ?? []).filter(
    (status) =>
      status.organizationId === String(scope.organizationId) &&
      scope.taskIds.includes(status.taskId) &&
      importTaskStatusIsCurrent(status, scope.companyId, now),
  )
}
