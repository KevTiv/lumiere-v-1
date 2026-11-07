import { z } from "zod"
import type { ChatImportTaskStatus } from "@lumiere/ui/lib/import-task-status"
import { importTaskStatusIsCurrent } from "@lumiere/ui/lib/import-task-status"

const id = z.string().regex(/^[1-9]\d{0,19}$/)
const count = z.number().int().min(0).max(1_000_000_000)
const decimal = z.string().regex(/^\d{1,20}(?:\.\d{1,6})?$/)
const timestamp = z.string().datetime({ offset: true })
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
    taskId: z.string().regex(/^[a-f0-9]{32}$/),
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
          verifiedResult: z
            .object({
              recordCount: count.max(200),
              lineCount: count.max(400),
              totalDebit: decimal,
              totalCredit: decimal,
              currencyId: id,
              postedCount: z.literal(0),
              verifiedAt: timestamp,
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
          amountUnits(result.totalDebit) !== amountUnits(result.totalCredit))
      )
        issue()
    }
  })

export function parseImportTaskStatuses(
  raw: unknown,
): ChatImportTaskStatus[] | undefined {
  return raw === undefined ? undefined : z.array(statusSchema).max(4).parse(raw)
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
