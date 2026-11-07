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
  sourceRows: { total: number; ready: number; held: number; excluded: number }
  proposalCount: number
  proposals: Array<{
    id: string
    status: "prepared" | "approved" | "executing" | "verified" | "blocked"
    phase: "not_started" | "headers" | "lines" | "verification" | "complete"
    expectedRecords: number
    verifiedResult: {
      recordCount: number
      lineCount: number
      totalDebit: string
      totalCredit: string
      currencyId: string
      postedCount: 0
      verifiedAt: string
    } | null
  }>
  nativeResults: ChatImportNativeResult[]
  nativeResultsMore: boolean
}

export const IMPORT_TASK_STATUS_MAX_AGE_MS = 5 * 60 * 1000

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
