/** Native job counts are evidence of a saved request, not domain-record readback. */
export interface ChatImportNativeResult {
  requestId: string
  entity: "product" | "contact" | "stock_location"
  state: "awaiting_receipt" | "receipt_available"
  verification: "native_receipt_only"
  receipt: {
    jobId: string
    status: "pending" | "success" | "partial" | "failed" | "rolled_back"
    totalRows: number
    rowsImported: number
    errorRows: number
  } | null
}

export interface ChatImportPostingStatus {
  proposalId: string
  recordCount: number
  draftCount: number
  postedCount: number
  otherCount: number
  unavailableCount: number
}

export interface ChatImportJournalRecord {
  id: string
  reference: string
}

export interface ChatImportReviewedRecords {
  counts: { verified: number; alreadyPresent: number }
  records: Array<{
    id: string
    module: "sales" | "shop_sales" | "warehouse"
    periodStart: string
    displayLabel?: string
  }>
  more: boolean
  salesTotals?: Array<{ currency: string; amount: string; count: number }>
}

/** Deterministic saved status, separate from generated assistant prose. */
export interface ChatImportTaskStatus {
  taskId: string
  companyId: string
  organizationId: string
  readAt: string
  preparationStatus:
    | "awaiting_decision"
    | "saved"
    | "needs_review"
    | "inspection_ready"
    | "failed"
  fileNames?: string[]
  sourceRows: { total: number; ready: number; held: number; excluded: number }
  proposalCount: number
  proposals: Array<{
    id: string
    status: "prepared" | "approved" | "executing" | "verified" | "blocked"
    phase: "not_started" | "headers" | "lines" | "verification" | "complete"
    expectedRecords: number
    heldRecords?: number
    verifiedResult: {
      recordCount: number
      lineCount: number
      totalDebit: string
      totalCredit: string
      currencyId: string
      postedCount: 0
      verifiedAt: string
      records?: ChatImportJournalRecord[]
    } | null
  }>
  nativeResults: ChatImportNativeResult[]
  nativeResultsMore: boolean
  reviewedRecords?: ChatImportReviewedRecords
}

export const IMPORT_TASK_STATUS_MAX_AGE_MS = 5 * 60 * 1000

export function importTaskNextView({
  preparationStatus,
  sourceRows,
  hasPreparedProposal,
  hasResults,
}: Pick<ChatImportTaskStatus, "preparationStatus" | "sourceRows"> & {
  hasPreparedProposal: boolean
  hasResults: boolean
}): "sources" | "decisions" | "preview" | "results" {
  if (preparationStatus === "inspection_ready") {
    return sourceRows.total ? "decisions" : "sources"
  }
  if (preparationStatus !== "needs_review") return "sources"
  if (hasResults) return "results"
  if (hasPreparedProposal || (sourceRows.ready > 0 && sourceRows.held === 0)) {
    return "preview"
  }
  return sourceRows.total ? "decisions" : "sources"
}

export function importTaskHasResults(status: ChatImportTaskStatus): boolean {
  return (status.reviewedRecords?.counts.verified ?? 0) > 0 ||
    status.proposals.some(({ status }) => status !== "prepared") ||
    (status.nativeResults?.length ?? 0) > 0
}

export function importTaskStatusIsCurrent(
  status: ChatImportTaskStatus,
  companyId: number | undefined,
  now = Date.now(),
): boolean {
  const readAt = Date.parse(status.readAt)
  return (
    companyId != null &&
    Number.isSafeInteger(companyId) &&
    companyId > 0 &&
    status.companyId === String(companyId) &&
    /^[0-9a-f]{32}$/.test(status.taskId) &&
    Number.isFinite(readAt) &&
    readAt <= now + 5000 &&
    now - readAt < IMPORT_TASK_STATUS_MAX_AGE_MS
  )
}
