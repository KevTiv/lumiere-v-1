import type { ColumnMappingMap } from "./csv-import-transform"
import {
  ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS,
  accountMoveBundleToken,
  accountMoveBundleMappings,
  type SplitImportBundleArgs,
} from "./csv-import-bundles"
import { parseAccountingImportNumber } from "./accounting-import-reconciliation"

export const HISTORICAL_DOCUMENT_METADATA_KEY = "lumiere_historical_document"

export const OUTSTANDING_DOCUMENT_IMPORT_COLUMNS = {
  required: [
    "document_type",
    "reference",
    "journal_id",
    "partner_id",
    "counterpart_account_id",
    "opening_account_id",
    "posting_date",
    "invoice_date",
    "due_date",
    "source_total",
    "opening_residual",
  ] as const,
  optional: ["currency_id", "document_number", "payment_reference", "metadata"] as const,
} as const

/**
 * Original-total reconstruction needs an already posted historical payment.
 * The alpha format accepts one aggregate paid-to-date transaction per document;
 * a transaction may still allocate across multiple document rows.
 */
export const HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS = {
  required: [
    ...OUTSTANDING_DOCUMENT_IMPORT_COLUMNS.required,
    "payment_transaction_id",
  ] as const,
  optional: OUTSTANDING_DOCUMENT_IMPORT_COLUMNS.optional,
} as const

/** Mirrors the authenticated BFF batch guard. */
export const MAX_HISTORICAL_PAYMENT_ALLOCATIONS_PER_TRANSACTION = 500

export type OutstandingDocumentType = "out_invoice" | "in_invoice"

export type OutstandingDocumentImportMode =
  | "cutover_open_residual"
  | "reconstruct_original_total"

export type OutstandingDocumentImportIssue = {
  code:
    | "empty_import"
    | "missing_mapping"
    | "missing_source_column"
    | "ambiguous_mapping"
    | "missing_value"
    | "invalid_document_type"
    | "invalid_identifier"
    | "invalid_date"
    | "invalid_amount"
    | "invalid_residual"
    | "unsupported_currency"
    | "duplicate_reference"
    | "reserved_metadata"
    | "allocation_limit"
  message: string
  rowNumber?: number
  field?: string
  reference?: string
}

export class OutstandingDocumentImportError extends Error {
  readonly issues: readonly OutstandingDocumentImportIssue[]

  constructor(issues: readonly OutstandingDocumentImportIssue[]) {
    super(issues.map((issue) => issue.message).join("; "))
    this.name = "OutstandingDocumentImportError"
    this.issues = issues
  }
}

export type PrepareOutstandingDocumentImportArgs = {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
  /** Source column to outstanding-document field. */
  mapping: ColumnMappingMap
  /**
   * `cutover_open_residual` books only the balance still open at cutover.
   * `reconstruct_original_total` books the source face value so historical
   * payments can subsequently be replayed. Defaults to cutover-only.
   */
  mode?: OutstandingDocumentImportMode
  /** Company currency ID. Historical alpha imports do not support foreign currency. */
  companyCurrencyId?: string | number | bigint
  /** Stable identity of the exact uploaded file, used only for guarded resume. */
  importBatchIdentity?: string
}

export type PreparedOutstandingDocumentImport = {
  mode: OutstandingDocumentImportMode
  headers: string[]
  rows: string[][]
  parentMapping: ColumnMappingMap
  lineMapping: ColumnMappingMap
  parentReferenceSourceColumn: "ref_"
  documentCount: number
  openingResidualTotal: number
  sourceTotal: number
  sourcePaidToDateTotal: number
  /** Total booked to both sides of the generated document bundles. */
  bookedDocumentTotal: number
  /** One atomic reducer call per posted historical payment transaction. */
  paymentReplayGroups: HistoricalPaymentReplayGroup[]
  /** Exact source facts used to validate same-file resume after a partial run. */
  documentResumeChecks: HistoricalDocumentResumeCheck[]
  importBatchIdentity: string
}

export type HistoricalPaymentReplayAllocation = {
  documentReference: string
  postingDate: string
  allocatedAmount: number
  expectedResidualAfter: number
  completesDocumentHistory: true
}

export type HistoricalDocumentResumeCheck = {
  reference: string
  importIdentity: string
  journalId: string
  partnerId: string
  currencyId: string
  documentType: OutstandingDocumentType
  postingDate: string
  invoiceDate: string
  dueDate: string
  sourceTotal: number
  expectedResidual: number
  counterpartAccountId: string
  openingAccountId: string
}

export type HistoricalPaymentReplayGroup = {
  paymentTransactionId: string
  currencyId: string
  partnerId: string
  documentType: OutstandingDocumentType
  allocations: HistoricalPaymentReplayAllocation[]
}

const CANONICAL_HEADERS = [
  "journal_id",
  "ref_",
  "date",
  "move_type",
  "invoice_date",
  "invoice_date_due",
  "partner_id",
  "currency_id",
  "amount_untaxed",
  "amount_tax",
  "amount_total",
  ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveOpeningResidual,
  "payment_reference",
  ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveName,
  ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineName,
  "account_id",
  "debit",
  "credit",
  ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineOpeningResidual,
  "metadata",
] as const

function canonicalDocumentType(raw: string): OutstandingDocumentType | undefined {
  switch (raw.trim().toLowerCase().replace(/[ -]+/g, "_")) {
    case "customer_invoice":
    case "sales_invoice":
    case "out_invoice":
      return "out_invoice"
    case "vendor_bill":
    case "supplier_bill":
    case "purchase_invoice":
    case "in_invoice":
      return "in_invoice"
    default:
      return undefined
  }
}

function validPositiveId(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim())
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function stableAmount(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000
}

interface JsonObject {
  [key: string]: unknown
}

function historicalDocumentMetadata(
  raw: string,
  mode: OutstandingDocumentImportMode,
  importIdentity: string,
  importBatchIdentity: string,
  values: {
    sourceTotal: number
    sourcePaidToDate: number
    openingResidual: number
  },
): string {
  let metadata: JsonObject = {}
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as JsonObject
      } else {
        metadata.lumiere_preserved_user_metadata = raw
      }
    } catch {
      metadata.lumiere_preserved_user_metadata = raw
    }
  }
  const priorExtra = metadata.extra
  const priorExtraIsObject =
    priorExtra != null && typeof priorExtra === "object" && !Array.isArray(priorExtra)
  const extra =
    priorExtraIsObject
      ? { ...(priorExtra as JsonObject) }
      : {}
  if (Object.prototype.hasOwnProperty.call(extra, HISTORICAL_DOCUMENT_METADATA_KEY)) {
    throw new Error(`metadata.extra.${HISTORICAL_DOCUMENT_METADATA_KEY} is reserved`)
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "extra") && !priorExtraIsObject) {
    metadata.lumiere_preserved_user_metadata_extra = priorExtra
  }
  extra[HISTORICAL_DOCUMENT_METADATA_KEY] = {
    version: 1,
    import_identity: importIdentity,
    batch_identity: importBatchIdentity,
    mode:
      mode === "reconstruct_original_total"
        ? "original_total"
        : "cutover_open_residual",
    source_total: values.sourceTotal,
    source_paid_to_date: values.sourcePaidToDate,
    expected_open_residual: values.openingResidual,
  }
  return JSON.stringify({ ...metadata, extra })
}

/**
 * Validate one-row-per-document migration data and expand every outstanding
 * invoice or bill into a balanced AR/AP plus cutover-account journal bundle.
 * Residual-only mode books the cutover balance. Original-total mode books the
 * source face value and records the target cutover residual for payment replay.
 */
export function prepareOutstandingDocumentImport(
  args: PrepareOutstandingDocumentImportArgs,
): PreparedOutstandingDocumentImport {
  const mode = args.mode ?? "cutover_open_residual"
  const companyCurrencyId =
    args.companyCurrencyId == null ? undefined : String(args.companyCurrencyId).trim()
  if (companyCurrencyId != null && !validPositiveId(companyCurrencyId)) {
    throw new Error("Outstanding-document companyCurrencyId must be a positive integer ID")
  }
  const importBatchIdentity =
    args.importBatchIdentity ??
    accountMoveBundleToken(JSON.stringify({ headers: args.headers, rows: args.rows }))

  const issues: OutstandingDocumentImportIssue[] = []
  const requiredColumns =
    mode === "reconstruct_original_total"
      ? HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS.required
      : OUTSTANDING_DOCUMENT_IMPORT_COLUMNS.required
  const sourceByTarget = new Map<string, string>()
  const headerSet = new Set(args.headers)
  for (const [source, rawTarget] of Object.entries(args.mapping)) {
    const target = rawTarget.trim().toLowerCase()
    if (!target || target === "__skip__") continue
    if (!headerSet.has(source)) {
      issues.push({
        code: "missing_source_column",
        field: target,
        message: `Mapped source column "${source}" was not found in the file`,
      })
      continue
    }
    const previous = sourceByTarget.get(target)
    if (previous) {
      issues.push({
        code: "ambiguous_mapping",
        field: target,
        message: `Both "${previous}" and "${source}" are mapped to ${target}`,
      })
      continue
    }
    sourceByTarget.set(target, source)
  }
  for (const target of requiredColumns) {
    if (!sourceByTarget.has(target)) {
      issues.push({
        code: "missing_mapping",
        field: target,
        message: `No source column is mapped to ${target}`,
      })
    }
  }
  if (args.rows.length === 0) {
    issues.push({
      code: "empty_import",
      message: "Outstanding-document import requires at least one data row",
    })
  }
  if (issues.length > 0) throw new OutstandingDocumentImportError(issues)

  const headerIndex = new Map(args.headers.map((header, index) => [header, index]))
  const value = (row: readonly string[], target: string): string => {
    const source = sourceByTarget.get(target)
    const index = source == null ? undefined : headerIndex.get(source)
    return index == null ? "" : (row[index] ?? "").trim()
  }
  const seenReferences = new Map<string, number>()
  const canonicalRows: string[][] = []
  const replayGroups = new Map<string, HistoricalPaymentReplayGroup>()
  const documentResumeChecks: HistoricalDocumentResumeCheck[] = []
  let openingResidualTotal = 0
  let sourceTotal = 0
  let sourcePaidToDateTotal = 0
  let bookedDocumentTotal = 0

  for (const [index, row] of args.rows.entries()) {
    const rowNumber = index + 2
    const reference = value(row, "reference")
    const requiredValues = requiredColumns.filter(
      (field) => !value(row, field),
    )
    for (const field of requiredValues) {
      issues.push({
        code: "missing_value",
        rowNumber,
        field,
        reference: reference || undefined,
        message: `Row ${rowNumber} is missing ${field}`,
      })
    }
    if (requiredValues.length > 0) continue

    const firstRow = seenReferences.get(reference)
    if (firstRow != null) {
      issues.push({
        code: "duplicate_reference",
        rowNumber,
        field: "reference",
        reference,
        message: `Rows ${firstRow} and ${rowNumber} use the same document reference "${reference}"`,
      })
      continue
    }
    seenReferences.set(reference, rowNumber)

    const documentType = canonicalDocumentType(value(row, "document_type"))
    if (!documentType) {
      issues.push({
        code: "invalid_document_type",
        rowNumber,
        field: "document_type",
        reference,
        message: `Row ${rowNumber} has an unsupported document_type; use customer_invoice or vendor_bill`,
      })
      continue
    }

    let invalid = false
    for (const field of [
      "journal_id",
      "partner_id",
      "counterpart_account_id",
      "opening_account_id",
    ]) {
      if (!validPositiveId(value(row, field))) {
        issues.push({
          code: "invalid_identifier",
          rowNumber,
          field,
          reference,
          message: `Row ${rowNumber} ${field} must be a positive integer ID`,
        })
        invalid = true
      }
    }
    const currencyId = value(row, "currency_id")
    if (currencyId && !validPositiveId(currencyId)) {
      issues.push({
        code: "invalid_identifier",
        rowNumber,
        field: "currency_id",
        reference,
        message: `Row ${rowNumber} currency_id must be a positive integer ID`,
      })
      invalid = true
    }
    if (companyCurrencyId && currencyId && currencyId !== companyCurrencyId) {
      issues.push({
        code: "unsupported_currency",
        rowNumber,
        field: "currency_id",
        reference,
        message: `Row ${rowNumber} currency_id must match company currency ${companyCurrencyId}; foreign-currency historical documents are not supported in alpha`,
      })
      invalid = true
    }
    const paymentTransactionId = value(row, "payment_transaction_id")
    if (
      mode === "reconstruct_original_total" &&
      !validPositiveId(paymentTransactionId)
    ) {
      issues.push({
        code: "invalid_identifier",
        rowNumber,
        field: "payment_transaction_id",
        reference,
        message: `Row ${rowNumber} payment_transaction_id must identify one posted aggregate historical payment`,
      })
      invalid = true
    }

    for (const field of ["posting_date", "invoice_date", "due_date"]) {
      if (!validIsoDate(value(row, field))) {
        issues.push({
          code: "invalid_date",
          rowNumber,
          field,
          reference,
          message: `Row ${rowNumber} ${field} must be a valid YYYY-MM-DD date`,
        })
        invalid = true
      }
    }
    if (
      validIsoDate(value(row, "invoice_date")) &&
      validIsoDate(value(row, "posting_date")) &&
      value(row, "posting_date") < value(row, "invoice_date")
    ) {
      issues.push({
        code: "invalid_date",
        rowNumber,
        field: "posting_date",
        reference,
        message: `Row ${rowNumber} posting_date cannot be before invoice_date`,
      })
      invalid = true
    }
    if (
      validIsoDate(value(row, "invoice_date")) &&
      validIsoDate(value(row, "due_date")) &&
      value(row, "due_date") < value(row, "invoice_date")
    ) {
      issues.push({
        code: "invalid_date",
        rowNumber,
        field: "due_date",
        reference,
        message: `Row ${rowNumber} due_date cannot be before invoice_date`,
      })
      invalid = true
    }

    let parsedSourceTotal: number | null = null
    let parsedResidual: number | null = null
    try {
      parsedSourceTotal = parseAccountingImportNumber(value(row, "source_total"))
    } catch {
      issues.push({
        code: "invalid_amount",
        rowNumber,
        field: "source_total",
        reference,
        message: `Row ${rowNumber} source_total is not a valid accounting amount`,
      })
      invalid = true
    }
    try {
      parsedResidual = parseAccountingImportNumber(value(row, "opening_residual"))
    } catch {
      issues.push({
        code: "invalid_amount",
        rowNumber,
        field: "opening_residual",
        reference,
        message: `Row ${rowNumber} opening_residual is not a valid accounting amount`,
      })
      invalid = true
    }
    if (parsedSourceTotal == null || parsedSourceTotal <= 0) {
      issues.push({
        code: "invalid_amount",
        rowNumber,
        field: "source_total",
        reference,
        message: `Row ${rowNumber} source_total must be greater than zero`,
      })
      invalid = true
    }
    if (
      parsedResidual == null ||
      parsedResidual <= 0 ||
      (parsedSourceTotal != null && parsedResidual > parsedSourceTotal)
    ) {
      issues.push({
        code: "invalid_residual",
        rowNumber,
        field: "opening_residual",
        reference,
        message: `Row ${rowNumber} opening_residual must be greater than zero and cannot exceed source_total`,
      })
      invalid = true
    }
    if (
      mode === "reconstruct_original_total" &&
      parsedSourceTotal != null &&
      parsedResidual != null &&
      parsedResidual >= parsedSourceTotal
    ) {
      issues.push({
        code: "invalid_residual",
        rowNumber,
        field: "opening_residual",
        reference,
        message: `Row ${rowNumber} opening_residual must be less than source_total when replaying historical payments`,
      })
      invalid = true
    }
    if (invalid || parsedSourceTotal == null || parsedResidual == null) continue

    const originalTotal = stableAmount(parsedSourceTotal)
    const residual = stableAmount(parsedResidual)
    const sourcePaidToDate = stableAmount(originalTotal - residual)
    const effectiveCurrencyId = currencyId || companyCurrencyId || ""
    const importIdentity = accountMoveBundleToken(JSON.stringify({
      documentType,
      reference,
      journalId: value(row, "journal_id"),
      partnerId: value(row, "partner_id"),
      counterpartAccountId: value(row, "counterpart_account_id"),
      openingAccountId: value(row, "opening_account_id"),
      postingDate: value(row, "posting_date"),
      invoiceDate: value(row, "invoice_date"),
      dueDate: value(row, "due_date"),
      sourceTotal: originalTotal,
      expectedResidual: residual,
      currencyId: effectiveCurrencyId,
      documentNumber: value(row, "document_number"),
      paymentReference: value(row, "payment_reference"),
      userMetadata: value(row, "metadata"),
    }))
    let metadata: string
    try {
      metadata = historicalDocumentMetadata(
        value(row, "metadata"),
        mode,
        importIdentity,
        importBatchIdentity,
        {
          sourceTotal: originalTotal,
          sourcePaidToDate,
          openingResidual: residual,
        },
      )
    } catch {
      issues.push({
        code: "reserved_metadata",
        rowNumber,
        field: "metadata",
        reference,
        message: `Row ${rowNumber} metadata already contains the reserved historical-document marker`,
      })
      continue
    }

    const bookedAmount =
      mode === "reconstruct_original_total" ? originalTotal : residual
    const common = {
      journal_id: value(row, "journal_id"),
      ref_: reference,
      date: value(row, "posting_date"),
      move_type: documentType,
      invoice_date: value(row, "invoice_date"),
      invoice_date_due: value(row, "due_date"),
      partner_id: value(row, "partner_id"),
      currency_id: currencyId,
      amount_untaxed: bookedAmount.toString(),
      amount_tax: "0",
      amount_total: bookedAmount.toString(),
      move_opening_residual: bookedAmount.toString(),
      payment_reference: value(row, "payment_reference"),
      move_name: value(row, "document_number"),
      metadata,
    }
    const counterpartDebit = documentType === "out_invoice" ? bookedAmount : 0
    const counterpartCredit = documentType === "in_invoice" ? bookedAmount : 0
    const rowsToAdd = [
      {
        ...common,
        line_name: `Opening ${documentType === "out_invoice" ? "receivable" : "payable"} ${reference}`,
        account_id: value(row, "counterpart_account_id"),
        debit: counterpartDebit.toString(),
        credit: counterpartCredit.toString(),
        line_opening_residual: bookedAmount.toString(),
      },
      {
        ...common,
        line_name: `Opening balance offset ${reference}`,
        account_id: value(row, "opening_account_id"),
        debit: counterpartCredit.toString(),
        credit: counterpartDebit.toString(),
        line_opening_residual: "",
      },
    ]
    canonicalRows.push(
      ...rowsToAdd.map((entry) =>
        CANONICAL_HEADERS.map((header) => entry[header as keyof typeof entry] ?? ""),
      ),
    )
    documentResumeChecks.push({
      reference,
      importIdentity,
      journalId: value(row, "journal_id"),
      partnerId: value(row, "partner_id"),
      currencyId: effectiveCurrencyId,
      documentType,
      postingDate: value(row, "posting_date"),
      invoiceDate: value(row, "invoice_date"),
      dueDate: value(row, "due_date"),
      sourceTotal: originalTotal,
      expectedResidual: residual,
      counterpartAccountId: value(row, "counterpart_account_id"),
      openingAccountId: value(row, "opening_account_id"),
    })
    if (mode === "reconstruct_original_total") {
      if (!effectiveCurrencyId) {
        issues.push({
          code: "missing_value",
          rowNumber,
          field: "currency_id",
          reference,
          message: `Row ${rowNumber} needs currency_id when no company currency was supplied`,
        })
        continue
      }
      const existing = replayGroups.get(paymentTransactionId)
      if (existing && existing.currencyId !== effectiveCurrencyId) {
        issues.push({
          code: "unsupported_currency",
          rowNumber,
          field: "currency_id",
          reference,
          message: `Rows for payment_transaction_id ${paymentTransactionId} must use one company currency`,
        })
        continue
      }
      if (
        existing &&
        (existing.partnerId !== value(row, "partner_id") ||
          existing.documentType !== documentType)
      ) {
        issues.push({
          code: "invalid_identifier",
          rowNumber,
          field: "payment_transaction_id",
          reference,
          message: `Rows for payment_transaction_id ${paymentTransactionId} must use one partner and one document type`,
        })
        continue
      }
      const group = existing ?? {
        paymentTransactionId,
        currencyId: effectiveCurrencyId,
        partnerId: value(row, "partner_id"),
        documentType,
        allocations: [],
      }
      if (
        group.allocations.length >=
        MAX_HISTORICAL_PAYMENT_ALLOCATIONS_PER_TRANSACTION
      ) {
        issues.push({
          code: "allocation_limit",
          rowNumber,
          field: "payment_transaction_id",
          reference,
          message: `payment_transaction_id ${paymentTransactionId} exceeds the ${MAX_HISTORICAL_PAYMENT_ALLOCATIONS_PER_TRANSACTION}-document alpha limit; use residual-only mode or consolidate the migration source`,
        })
        continue
      }
      group.allocations.push({
        documentReference: reference,
        postingDate: value(row, "posting_date"),
        allocatedAmount: sourcePaidToDate,
        expectedResidualAfter: residual,
        completesDocumentHistory: true,
      })
      replayGroups.set(paymentTransactionId, group)
    }
    openingResidualTotal += residual
    sourceTotal += originalTotal
    sourcePaidToDateTotal += sourcePaidToDate
    bookedDocumentTotal += bookedAmount
  }

  if (issues.length > 0) throw new OutstandingDocumentImportError(issues)
  const headers = [...CANONICAL_HEADERS]
  const { parentMapping, lineMapping } = accountMoveBundleMappings(headers)
  return {
    mode,
    headers,
    rows: canonicalRows,
    parentMapping,
    lineMapping,
    parentReferenceSourceColumn: "ref_",
    documentCount: args.rows.length,
    openingResidualTotal: stableAmount(openingResidualTotal),
    sourceTotal: stableAmount(sourceTotal),
    sourcePaidToDateTotal: stableAmount(sourcePaidToDateTotal),
    bookedDocumentTotal: stableAmount(bookedDocumentTotal),
    paymentReplayGroups: [...replayGroups.values()].sort((left, right) =>
      left.paymentTransactionId.localeCompare(right.paymentTransactionId),
    ),
    documentResumeChecks,
    importBatchIdentity,
  }
}

/** Shape accepted directly by splitAccountMoveImportCsv. */
export function outstandingDocumentSplitArgs(
  prepared: PreparedOutstandingDocumentImport,
): Omit<SplitImportBundleArgs, "strictParentReferences"> {
  return {
    headers: prepared.headers,
    rows: prepared.rows,
    parentMapping: prepared.parentMapping,
    lineMapping: prepared.lineMapping,
    parentLinkSourceColumn: prepared.parentReferenceSourceColumn,
  }
}
