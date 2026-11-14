import { z } from "zod"

const positiveId = z.string().regex(/^[1-9]\d*$/)
const requestId = z.string().regex(/^[0-9a-f]{32}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const decimal = z.string().regex(/^-?\d{1,20}(?:\.\d{1,6})?$/)
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + "T00:00:00Z")
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, "Use a valid calendar date.")
const count = z.number().int().nonnegative()
const sourceRevision = z.object({
  itemId: positiveId,
  batchId: positiveId,
  revision: z.number().int().positive(),
})
const distinctExpenseSchema = z
  .object({
    itemId: positiveId,
    sourceRevision: z.number().int().positive(),
    candidateDigest: digest,
    reason: z.string().trim().min(3).max(2000),
  })
  .strict()
export type DistinctExpenseDecision = z.infer<typeof distinctExpenseSchema>

const overlapCandidateSchema = z
  .object({
    origin: z.enum(["selected_rows", "saved_proposal"]),
    proposalId: positiveId.nullable(),
    proposalDigest: digest.nullable(),
    itemId: positiveId,
    sourceRevision: z.number().int().positive(),
    reason: z.enum([
      "same_source",
      "same_reference",
      "overlapping_period_amount",
    ]),
    dateFrom: day,
    dateToExclusive: day,
    postingDate: day,
    amount: decimal,
    currencyId: positiveId,
    externalReference: z.string().nullable(),
    category: z.string().nullable(),
  })
  .refine(
    (candidate) =>
      candidate.origin === "saved_proposal"
        ? candidate.proposalId !== null && candidate.proposalDigest !== null
        : candidate.proposalId === null && candidate.proposalDigest === null,
    "The overlap evidence is missing its saved proposal identity.",
  )

export const importCapabilitySchema = z.object({
  key: z.string().min(1),
  module: z.string().min(1),
  label: z.string().min(1),
  targetEntities: z.array(z.string()),
  requiredFacts: z.array(z.string()),
  readiness: z.enum(["task_execution", "native_preview", "reviewed_records", "evidence_only"]),
  blockingReason: z.string().nullable(),
  destination: z.string().regex(/^\/(?!\/)[^\\\s]*$/),
})

const proposalSchema = z.object({
  id: positiveId,
  requestKey: requestId,
  revision: z.number().int().positive(),
  digest,
  kind: z.literal("historical_expense_journals"),
  status: z.enum(["prepared", "approved", "executing", "verified", "blocked"]),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  summary: z.object({
    recordCount: count,
    lineCount: count,
    blockedCount: count,
    totalDebit: decimal,
    totalCredit: decimal,
    currencyId: positiveId,
    dateFrom: day.nullable(),
    dateTo: day.nullable(),
  }),
  sources: z.array(sourceRevision),
  entries: z
    .array(
      z.object({
        itemId: positiveId,
        batchId: positiveId,
        sourceRevision: z.number().int().positive(),
        sourceFile: z.string(),
        sourceRow: z.number().int().positive(),
        sourceSha256: digest,
        reference: z.string(),
        date: day,
        description: z.string(),
        amount: decimal,
      }),
    )
    .max(200),
  issues: z.array(
    z.object({
      itemId: positiveId.nullable(),
      code: z.string(),
      message: z.string(),
      candidates: z.array(overlapCandidateSchema).optional(),
      resolution: z
        .object({
          kind: z.literal("distinct_expenses"),
          candidateDigest: digest,
        })
        .nullish(),
    }),
  ),
  configuration: z.object({
    journalId: positiveId,
    debitAccountId: positiveId,
    creditAccountId: positiveId,
    currencyId: positiveId,
    dateField: z.string(),
    amountField: z.string(),
    descriptionField: z.string().nullable(),
    postingDate: day.nullable(),
    reason: z.string(),
    distinctExpenses: z.array(distinctExpenseSchema).max(200).optional(),
  }),
  execution: z.object({
    phase: z.enum([
      "not_started",
      "headers",
      "lines",
      "verification",
      "complete",
    ]),
    parentRequestId: requestId.nullable(),
    lineRequestId: requestId.nullable(),
    parentJobId: positiveId.nullable(),
    lineJobId: positiveId.nullable(),
  }),
  result: z
    .object({
      verifiedAt: z.string(),
      recordCount: count,
      lineCount: count,
      totalDebit: decimal,
      totalCredit: decimal,
      currencyId: positiveId,
      companyId: positiveId,
      recordIds: z.array(positiveId),
      lineIds: z.array(positiveId),
      postedCount: z.literal(0),
    })
    .nullable(),
  lastError: z.string().nullable(),
})

export type ImportCapability = z.infer<typeof importCapabilitySchema>
export type ImportProposal = z.infer<typeof proposalSchema>
const nativeResultSchema = z
  .object({
    requestId,
    entity: z.enum(["product", "contact", "stock_location"]),
    fileName: z.string().nullable(),
    contentSha256: digest,
    reviewItemCount: count,
    reviewIds: z.array(positiveId),
    submittedAt: z.string(),
    state: z.enum(["awaiting_receipt", "receipt_available"]),
    verification: z.literal("native_receipt_only"),
    receipt: z
      .object({
        jobId: positiveId,
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
  .superRefine((result, context) => {
    const receipt = result.receipt
    if (
      (result.state === "receipt_available") !== (receipt !== null) ||
      (receipt &&
        (receipt.rowsImported > receipt.totalRows ||
          receipt.errorRows > receipt.totalRows))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The saved native receipt has inconsistent status or counts.",
      })
    }
  })
export type ImportNativeResult = z.infer<typeof nativeResultSchema>
export interface ImportWorkflow {
  version: 1
  requestId: string
  organizationId: string
  companyId: string
  capabilities: ImportCapability[]
  proposals: ImportProposal[]
  nativeResults: ImportNativeResult[]
  nativeResultsMore: boolean
  backfilledRecords?: Array<{ module: "sales" | "warehouse"; count: number }>
}
export type WorkflowFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>
export interface WorkflowScope {
  organizationId: number
  companyId: number
  taskId: string
}
export interface PrepareImportProposal {
  previousProposalId?: string
  rows: { itemId: string; expectedRevision: number }[]
  journalId: string
  debitAccountId: string
  creditAccountId: string
  currencyId: string
  dateField: string
  amountField: string
  descriptionField?: string
  postingDate?: string
  reason: string
  distinctExpenses?: DistinctExpenseDecision[]
}

const prepareInputSchema = z
  .object({
    previousProposalId: positiveId.optional(),
    rows: z
      .array(
        z
          .object({
            itemId: positiveId,
            expectedRevision: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1, "Choose 1 to 200 different source rows for this preview.")
      .max(200, "Choose 1 to 200 different source rows for this preview."),
    journalId: positiveId,
    debitAccountId: positiveId,
    creditAccountId: positiveId,
    currencyId: positiveId,
    dateField: z.string().regex(/^[A-Za-z0-9_]{1,100}$/),
    amountField: z.string().regex(/^[A-Za-z0-9_]{1,100}$/),
    descriptionField: z
      .string()
      .regex(/^[A-Za-z0-9_]{1,100}$/)
      .optional(),
    postingDate: day.optional(),
    reason: z.string().trim().min(3).max(2000),
    distinctExpenses: z.array(distinctExpenseSchema).max(200).optional(),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.rows.map((row) => row.itemId)).size === input.rows.length,
    "Choose 1 to 200 different source rows for this preview.",
  )

const attemptSchema = z
  .object({ requestKey: requestId, input: prepareInputSchema })
  .strict()
export type ImportProposalAttempt = z.infer<typeof attemptSchema>
export class ImportWorkflowRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ImportWorkflowRequestError"
  }
}

function units(value: string): bigint {
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".")
  const scaled = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))
  return negative ? -scaled : scaled
}

/** Reject mismatched or incomplete receipts before any client reports completion. */
export function parseImportProposal(
  value: unknown,
  companyId: number,
): ImportProposal {
  const proposal = proposalSchema.parse(value)
  const { summary, entries, result } = proposal
  if (
    summary.recordCount !== entries.length ||
    summary.lineCount !== entries.length * 2 ||
    summary.blockedCount !== proposal.sources.length - entries.length ||
    new Set(proposal.sources.map((source) => source.itemId)).size !==
      proposal.sources.length ||
    new Set(entries.map((entry) => entry.itemId)).size !== entries.length ||
    entries.some(
      (entry) =>
        !proposal.sources.some(
          (source) =>
            source.itemId === entry.itemId &&
            source.batchId === entry.batchId &&
            source.revision === entry.sourceRevision,
        ),
    ) ||
    entries.some((entry) => units(entry.amount) <= 0n) ||
    units(summary.totalDebit) !==
      entries.reduce((total, entry) => total + units(entry.amount), 0n) ||
    units(summary.totalCredit) !== units(summary.totalDebit) ||
    summary.currencyId !== proposal.configuration.currencyId
  ) {
    throw new Error(
      "The preview does not match its source rows. Reload the saved import before continuing.",
    )
  }
  if (
    (proposal.status === "verified") !== (result !== null) ||
    (proposal.status === "verified") !==
      (proposal.execution.phase === "complete")
  ) {
    throw new Error(
      "The import result is incomplete. Check the saved execution before continuing.",
    )
  }
  if (
    result &&
    (result.companyId !== String(companyId) ||
      result.currencyId !== summary.currencyId ||
      result.recordCount !== summary.recordCount ||
      result.lineCount !== summary.lineCount ||
      result.recordIds.length !== result.recordCount ||
      result.lineIds.length !== result.lineCount ||
      new Set(result.recordIds).size !== result.recordCount ||
      new Set(result.lineIds).size !== result.lineCount ||
      units(result.totalDebit) !== units(summary.totalDebit) ||
      units(result.totalCredit) !== units(summary.totalCredit))
  ) {
    throw new Error(
      "The ERP readback does not match the approved preview and company.",
    )
  }
  return proposal
}

function workflowPath(scope: WorkflowScope): string {
  requestId.parse(scope.taskId)
  if (
    !Number.isSafeInteger(scope.organizationId) ||
    scope.organizationId < 1 ||
    !Number.isSafeInteger(scope.companyId) ||
    scope.companyId < 1
  )
    throw new Error("Select a company before opening an import.")
  return `/api/import-tasks/${scope.taskId}/workflow`
}

async function responseBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body)
    throw new ImportWorkflowRequestError(
      error.success
        ? error.data.error
        : "The saved import could not be checked. Reload it before retrying.",
      response.status,
    )
  }
  return body
}

export async function readImportWorkflow(
  fetcher: WorkflowFetch,
  scope: WorkflowScope,
): Promise<ImportWorkflow> {
  const body = await responseBody(
    await fetcher(workflowPath(scope) + `?companyId=${scope.companyId}`, {
      cache: "no-store",
    }),
  )
  const workflow = z
    .object({
      version: z.literal(1),
      requestId,
      organizationId: positiveId,
      companyId: positiveId,
      capabilities: z.array(importCapabilitySchema),
      proposals: z.array(z.unknown()),
      nativeResults: z.array(nativeResultSchema).max(20).default([]),
      nativeResultsMore: z.boolean().default(false),
      backfilledRecords: z.array(z.object({ module: z.enum(["sales", "warehouse"]), count })).optional(),
    })
    .parse(body)
  if (
    workflow.requestId !== scope.taskId ||
    workflow.companyId !== String(scope.companyId) ||
    workflow.organizationId !== String(scope.organizationId)
  ) {
    throw new Error("This workflow belongs to another import or company.")
  }
  return {
    ...workflow,
    proposals: workflow.proposals.map((value) =>
      parseImportProposal(value, scope.companyId),
    ),
  }
}

/** Freeze intent before dispatch; a later list refresh cannot change its predecessor. */
export async function createImportProposalAttempt(
  scope: WorkflowScope,
  value: PrepareImportProposal,
): Promise<ImportProposalAttempt> {
  workflowPath(scope)
  const input = prepareInputSchema.parse(value)
  input.rows.sort((left, right) =>
    left.itemId.localeCompare(right.itemId, "en", { numeric: true }),
  )
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ version: 1, ...scope, input })),
  )
  return {
    requestKey: Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 32),
    input,
  }
}

export function parseImportProposalAttempt(
  raw: unknown,
): ImportProposalAttempt {
  return attemptSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw)
}

export async function dispatchImportProposalAttempt(
  fetcher: WorkflowFetch,
  scope: WorkflowScope,
  value: ImportProposalAttempt,
): Promise<ImportProposal> {
  const attempt = parseImportProposalAttempt(value)
  const expected = await createImportProposalAttempt(scope, attempt.input)
  if (expected.requestKey !== attempt.requestKey)
    throw new Error(
      "The saved preview request does not match this company, task or source decisions.",
    )
  const { previousProposalId: _previous, ...input } = attempt.input
  const proposal = parseImportProposal(
    await responseBody(
      await fetcher(workflowPath(scope) + "/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: scope.companyId,
          ...input,
          requestKey: attempt.requestKey,
        }),
      }),
    ),
    scope.companyId,
  )
  if (proposal.requestKey !== attempt.requestKey)
    throw new Error(
      "The saved preview receipt belongs to another preparation request.",
    )
  return proposal
}

/** Exact absence is checked independently of the bounded proposal list. */
export async function readImportProposalAttempt(
  fetcher: WorkflowFetch,
  scope: WorkflowScope,
  key: string,
): Promise<ImportProposal | null> {
  const response = await fetcher(
    workflowPath(scope) +
      `/requests/${requestId.parse(key)}?companyId=${scope.companyId}`,
    { cache: "no-store" },
  )
  if (response.status === 404) return null
  const proposal = parseImportProposal(
    await responseBody(response),
    scope.companyId,
  )
  if (proposal.requestKey !== key)
    throw new Error(
      "The saved preview receipt belongs to another preparation request.",
    )
  return proposal
}

export async function prepareImportProposal(
  fetcher: WorkflowFetch,
  scope: WorkflowScope,
  input: PrepareImportProposal,
): Promise<ImportProposal> {
  return dispatchImportProposalAttempt(
    fetcher,
    scope,
    await createImportProposalAttempt(scope, input),
  )
}

export async function transitionImportProposal(
  fetcher: WorkflowFetch,
  scope: WorkflowScope,
  proposal: Pick<ImportProposal, "id" | "revision" | "digest">,
  action: "approve" | "execute" | "verify",
): Promise<ImportProposal> {
  const path =
    workflowPath(scope) +
    `/proposals/${positiveId.parse(proposal.id)}/${action}`
  const body = await responseBody(
    await fetcher(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: scope.companyId,
        expectedRevision: proposal.revision,
        expectedDigest: digest.parse(proposal.digest),
      }),
    }),
  )
  const result = parseImportProposal(body, scope.companyId)
  if (
    result.id !== proposal.id ||
    result.revision !== proposal.revision ||
    result.digest !== proposal.digest
  )
    throw new Error("The response does not match the approved preview.")
  return result
}
