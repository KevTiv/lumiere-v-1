import type { AllocatePaymentParams, StageBankStatementImportParams } from "@lumiere/stdb/types"
import { unwrapSome } from "@lumiere/erp-shared/form-coercion"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stdbTimestampToDate } from "@lumiere/erp-shared/timestamp-values"
import { variantTag } from "@lumiere/erp-workflows"
import type { FormValues } from "@lumiere/ui/lib/form-types"
import { statementImportIdempotencyKey, statementImportRows } from "@/lib/statement-import-csv"

export interface PaymentLookupRow {
  id?: unknown; organizationId?: unknown; companyId?: unknown; currencyId?: unknown
  partnerId?: unknown; partnerType?: unknown; direction?: unknown; status?: unknown
  paymentAccountId?: unknown; settlementAmount?: unknown; archivedAt?: unknown
  moveId?: unknown; moveName?: unknown; name?: unknown; state?: unknown; moveType?: unknown
  journalId?: unknown; accountId?: unknown; internalType?: unknown; internalGroup?: unknown; deprecated?: unknown
  amountResidual?: unknown; paymentTransactionId?: unknown; allocatedMoveLineId?: unknown
  allocatedAmount?: unknown; isReversal?: unknown; reversedReconciliationId?: unknown
  residualBefore?: unknown; residualAfter?: unknown; writeOffAmount?: unknown; writeOffAccountId?: unknown
  externalReference?: unknown
}

export function paymentId(value: unknown): bigint | null {
  const raw = unwrapSome(value)
  if (!/^[1-9]\d*$/.test(String(raw ?? ""))) return null
  return parseStrictU64(raw) ?? null
}

export function paymentAmount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function paymentInputAmount(value: unknown): number | null {
  return (typeof value !== "string" && typeof value !== "number") || String(value).trim() === "" ? null : paymentAmount(Number(value))
}

function scoped(row: PaymentLookupRow, organizationId: bigint, companyId: bigint) {
  return paymentId(row.organizationId) === organizationId && paymentId(row.companyId) === companyId
}

function exactRow(rows: readonly PaymentLookupRow[], id: unknown): PaymentLookupRow | null {
  const key = paymentId(id)
  if (key == null) return null
  const found = rows.filter((row) => paymentId(row.id) === key)
  return found.length === 1 ? found[0] : null
}

export interface AllocationItem { line: PaymentLookupRow; move: PaymentLookupRow; account: PaymentLookupRow; residual: number }
export type AllocationSource = { kind: "unavailable" } | {
  kind: "ready"; transaction: PaymentLookupRow; available: number; items: AllocationItem[]; writeOffAccounts: PaymentLookupRow[]
}

/** A read-only join over authorized projections. Eligibility is still checked by the allocation owner. */
export function allocationSource(input: {
  transactionId: unknown; organizationId: bigint; companyId: bigint; ready: boolean
  transactions: readonly PaymentLookupRow[]; paymentAccounts: readonly PaymentLookupRow[]
  reconciliations: readonly PaymentLookupRow[]; lines: readonly PaymentLookupRow[]
  moves: readonly PaymentLookupRow[]; glAccounts: readonly PaymentLookupRow[]
}): AllocationSource {
  if (!input.ready) return { kind: "unavailable" }
  const transaction = exactRow(input.transactions, input.transactionId)
  if (!transaction || !scoped(transaction, input.organizationId, input.companyId) || variantTag(transaction.status) !== "Posted") return { kind: "unavailable" }
  const currencyId = paymentId(transaction.currencyId)
  const partnerId = paymentId(transaction.partnerId)
  const partnerType = variantTag(transaction.partnerType)
  const settlement = paymentAmount(transaction.settlementAmount)
  const paymentAccount = exactRow(input.paymentAccounts, transaction.paymentAccountId)
  if (!currencyId || !partnerId || !["Customer", "Supplier"].includes(partnerType) || settlement == null
    || !paymentAccount || !scoped(paymentAccount, input.organizationId, input.companyId)
    || paymentId(paymentAccount.currencyId) !== currencyId || !("archivedAt" in paymentAccount) || unwrapSome(paymentAccount.archivedAt) != null) return { kind: "unavailable" }
  const allocations = input.reconciliations.filter((row) => paymentId(row.paymentTransactionId) === paymentId(transaction.id))
  const ids = allocations.map((row) => paymentId(row.id))
  if (ids.some((id) => id == null) || new Set(ids).size !== ids.length || allocations.some((row) =>
    !scoped(row, input.organizationId, input.companyId) || paymentId(row.currencyId) !== currencyId
    || paymentAmount(row.allocatedAmount) == null || typeof row.isReversal !== "boolean"
    || (row.isReversal && paymentId(row.reversedReconciliationId) == null),
  )) return { kind: "unavailable" }
  const available = Math.max(0, settlement - allocations.reduce((sum, row) => sum + (row.allocatedAmount as number), 0))
  if (!Number.isFinite(available)) return { kind: "unavailable" }
  const activeTargets = new Set(allocations.filter((row) => !row.isReversal && !allocations.some((candidate) => candidate.isReversal && paymentId(candidate.reversedReconciliationId) === paymentId(row.id))).map((row) => String(paymentId(row.allocatedMoveLineId))))
  const expectedType = partnerType === "Customer" ? "Receivable" : "Payable"
  const items: AllocationItem[] = []
  for (const line of input.lines) {
    const move = exactRow(input.moves, line.moveId)
    const account = exactRow(input.glAccounts, line.accountId)
    const residual = paymentAmount(line.amountResidual)
    if (!paymentId(line.id) || !scoped(line, input.organizationId, input.companyId)
      || input.lines.filter((row) => paymentId(row.id) === paymentId(line.id)).length !== 1
      || paymentId(line.partnerId) !== partnerId || paymentId(line.currencyId) !== currencyId || residual == null || residual === 0
      || activeTargets.has(String(line.id)) || !move || !scoped(move, input.organizationId, input.companyId)
      || variantTag(move.state) !== "Posted" || !["OutInvoice", "OutRefund", "InInvoice", "InRefund"].includes(variantTag(move.moveType))
      || paymentId(move.partnerId) !== partnerId || paymentId(move.currencyId) !== currencyId || paymentId(move.journalId) !== paymentId(line.journalId)
      || !account || !scoped(account, input.organizationId, input.companyId) || account.deprecated !== false || variantTag(unwrapSome(account.internalType)) !== expectedType) continue
    items.push({ line, move, account, residual: Math.abs(residual) })
  }
  const expectedGroup = partnerType === "Customer" ? "Expense" : "Income"
  const writeOffAccounts = input.glAccounts.filter((row) => exactRow(input.glAccounts, row.id) === row && scoped(row, input.organizationId, input.companyId) && row.deprecated === false && variantTag(unwrapSome(row.internalGroup)) === expectedGroup)
  return { kind: "ready", transaction, available, items, writeOffAccounts }
}

export type WorkflowReadback = { kind: "pending" } | { kind: "conflict" } | { kind: "ambiguous" } | { kind: "confirmed"; id: bigint }

/** The owner permits at most one active allocation for the exact transaction/line relation. */
export function allocationReadback(params: AllocatePaymentParams, rows: readonly PaymentLookupRow[], organizationId: bigint): WorkflowReadback {
  const related = rows.filter((row) => paymentId(row.paymentTransactionId) === params.paymentTransactionId)
  if (new Set(related.map((row) => String(paymentId(row.id)))).size !== related.length) return { kind: "ambiguous" }
  if (related.some((row) => !paymentId(row.id) || !scoped(row, organizationId, params.companyId)
    || typeof row.isReversal !== "boolean" || (row.isReversal && paymentId(row.reversedReconciliationId) == null))) return { kind: "conflict" }
  const active = related.filter((row) => row.isReversal === false && paymentId(row.allocatedMoveLineId) === params.allocatedMoveLineId
    && !related.some((candidate) => candidate.isReversal === true && paymentId(candidate.reversedReconciliationId) === paymentId(row.id)))
  if (active.length === 0) return { kind: "pending" }
  if (active.length !== 1) return { kind: "ambiguous" }
  const row = active[0]
  const id = paymentId(row.id)
  const before = paymentAmount(row.residualBefore)
  const after = paymentAmount(row.residualAfter)
  return id && scoped(row, organizationId, params.companyId) && paymentId(row.currencyId) === params.currencyId
    && paymentAmount(row.allocatedAmount) === params.allocatedAmount && paymentAmount(row.writeOffAmount) === params.writeOffAmount
    && "writeOffAccountId" in row && paymentId(row.writeOffAccountId) === (params.writeOffAccountId ?? null)
    && before != null && after != null && before >= 0 && after >= 0
    && Math.abs(after - Math.max(0, before - params.allocatedAmount - params.writeOffAmount)) <= 0.000001
    ? { kind: "confirmed", id } : { kind: "conflict" }
}

export interface PreparedStatementImport {
  file: File; companyId: bigint; journalId: bigint; currencyId: bigint; params: StageBankStatementImportParams
}

export function statementFile(value: unknown): File | null {
  if (typeof FileList !== "undefined" && value instanceof FileList) return value.item(0)
  return Array.isArray(value) ? value.find((file): file is File => typeof File !== "undefined" && file instanceof File) ?? null : null
}

export async function prepareStatementImport(values: FormValues, companyId: bigint, setupError = "Choose a CSV file, journal, currency, and finite opening balance"): Promise<PreparedStatementImport> {
  const file = statementFile(values.csvFile)
  const journalId = paymentId(values.journalId)
  const currencyId = paymentId(values.currencyId)
  const openingBalance = paymentInputAmount(values.openingBalance)
  if (!file || companyId <= 0n || !journalId || !currencyId || openingBalance == null) throw new Error(setupError)
  const csvData = await file.text()
  return { file, companyId, journalId, currencyId, params: {
    fileName: String(values.fileName ?? "").trim() || file.name,
    idempotencyKey: await statementImportIdempotencyKey(companyId, journalId, currencyId, csvData),
    openingBalance,
    rows: statementImportRows(csvData),
  } }
}

export function statementReviewMatches(review: PreparedStatementImport, values: FormValues, companyId: bigint) {
  return review.file === statementFile(values.csvFile) && review.companyId === companyId
    && review.journalId === paymentId(values.journalId) && review.currencyId === paymentId(values.currencyId)
    && review.params.openingBalance === paymentInputAmount(values.openingBalance)
    && review.params.fileName === (String(values.fileName ?? "").trim() || review.file.name)
}

export interface ImportProjection {
  id?: unknown; companyId?: unknown; journalId?: unknown; currencyId?: unknown; fileName?: unknown
  idempotencyKey?: unknown; openingBalance?: unknown; totalRows?: unknown
  importId?: unknown; rowNumber?: unknown; date?: unknown; amount?: unknown; reference?: unknown; description?: unknown
}

function timestampMs(value: unknown): number | null | undefined {
  const raw = unwrapSome(value)
  if (raw == null) return null
  return stdbTimestampToDate(raw)?.getTime()
}

/** This dedicated workspace endpoint has already authorized the current organization/company. */
export function statementImportReadback(review: PreparedStatementImport, imports: readonly ImportProjection[], lines: readonly ImportProjection[]): WorkflowReadback {
  const matches = imports.filter((row) => row.idempotencyKey === review.params.idempotencyKey && paymentId(row.companyId) === review.companyId)
  if (matches.length === 0) return { kind: "pending" }
  if (matches.length !== 1) return { kind: "ambiguous" }
  const row = matches[0]
  const id = paymentId(row.id)
  const savedLines = lines.filter((line) => paymentId(line.importId) === id)
  if (!id || paymentId(row.journalId) !== review.journalId || paymentId(row.currencyId) !== review.currencyId
    || unwrapSome(row.fileName) !== review.params.fileName || row.openingBalance !== review.params.openingBalance
    || row.totalRows !== review.params.rows.length || savedLines.length !== review.params.rows.length) return { kind: "conflict" }
  if (savedLines.some((line) => !paymentId(line.id)) || new Set(savedLines.map((line) => String(line.id))).size !== savedLines.length) return { kind: "ambiguous" }
  for (const expected of review.params.rows) {
    const found = savedLines.filter((line) => line.rowNumber === expected.rowNumber)
    if (found.length !== 1) return { kind: "ambiguous" }
    const saved = found[0]
    if (!["date", "amount", "reference", "description"].every((key) => key in saved) || timestampMs(saved.date) === undefined || timestampMs(saved.date) !== timestampMs(expected.date) || (unwrapSome(saved.amount) ?? null) !== (expected.amount ?? null)
      || (unwrapSome(saved.reference) ?? null) !== (expected.reference ?? null)
      || (unwrapSome(saved.description) ?? null) !== (expected.description ?? null)) return { kind: "conflict" }
  }
  return { kind: "confirmed", id }
}

/** Advisory preflight mirrors only the documented pilot envelope; staging remains the server's decision. */
export function statementRowReview(row: StageBankStatementImportParams["rows"][number]): "date" | "amount" | "zero" | "envelope" | null {
  if (!row.date) return "date"
  if (row.amount == null || !Number.isFinite(row.amount)) return "amount"
  if (row.amount === 0) return "zero"
  if (Math.abs(row.amount) > 1_000_000_000) return "envelope"
  return null
}

export function statementBalanceReview(review: PreparedStatementImport) {
  const validRows = review.params.rows.filter((row) => statementRowReview(row) === null)
  const movement = validRows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const closing = review.params.openingBalance + movement
  return { validRows: validRows.length, invalidRows: review.params.rows.length - validRows.length, movement, closing,
    withinEnvelope: [review.params.openingBalance, movement, closing].every((amount) => Number.isFinite(amount) && Math.abs(amount) <= 1_000_000_000) }
}
