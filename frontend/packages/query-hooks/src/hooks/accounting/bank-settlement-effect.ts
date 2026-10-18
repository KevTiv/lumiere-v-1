import { bankSettlementAttempt, bankSettlementRecoveryCorrelates, type BankSettlementAttempt, type BankSettlementPhase, type BankSettlementRecoveryRequest } from "@lumiere/erp-shared/bank-settlement-lifecycle"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

type Row = Readonly<Record<string, unknown>>
export interface BankSettlementLifecycleEffect {
  status: BankSettlementPhase
  attempt: BankSettlementAttempt
  organizationId: string
  companyId: string
  statementId: string
  lineId: string
  resource: "bank-statement-lines"
  id: string
}
export interface BankSettlementCanonicalRows {
  lines: readonly Row[]
  statements: readonly Row[]
  payments: readonly Row[]
  moves: readonly Row[]
  moveLines: readonly Row[]
}
const field = (row: Row, name: string): unknown => row[name] ?? row[name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]
const id = (value: unknown): string | null => { const parsed = parseStrictU64(value); return parsed != null && parsed > 0n ? String(parsed) : null }
const tag = (value: unknown): string => typeof value === "string" ? value.toLowerCase() : value && typeof value === "object" && "tag" in value ? String(value.tag).toLowerCase() : ""
const number = (value: unknown): number | null => {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}
const exact = (rows: readonly Row[], recordId: string | null | undefined): Row | null => {
  if (!recordId) return null
  const matches = rows.filter((row) => id(row.id) === recordId)
  return matches.length === 1 ? matches[0]! : null
}
const equalAmount = (value: unknown, expected: number): boolean => { const actual = number(value); return actual != null && Math.abs(actual - expected) <= 0.000001 }
const ids = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  const parsed = value.map(id)
  return parsed.every((entry): entry is string => entry != null) && new Set(parsed).size === parsed.length ? parsed : null
}
const sameIds = (actual: string[] | null, expected: readonly string[]) => actual != null && actual.length === expected.length && actual.every((entry) => expected.includes(entry))
const json = (value: unknown): Row | null => {
  if (typeof value === "string") { try { value = JSON.parse(value) } catch { return null } }
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Row : null
}
const timestampMicros = (value: unknown): string | null => {
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? String(BigInt(millis) * 1000n) : null
  }
  const row = json(value), micros = row?.microsSinceUnixEpoch ?? row?.micros_since_unix_epoch ?? row?.__timestamp_micros_since_unix_epoch__
  if ((typeof micros !== "string" && typeof micros !== "bigint" && !(typeof micros === "number" && Number.isSafeInteger(micros))) || !/^-?\d+$/.test(String(micros))) return null
  return String(micros)
}

/**
 * Public lifecycle hints alone never confirm a financial mutation. Every terminal
 * effect is tied to exact tenant-local records, original residuals and ledger moves.
 */
export function resolveBankSettlementLifecycleEffect(
  rows: BankSettlementCanonicalRows,
  scope: { organizationId: string; companyId: string; lineId: string; request?: BankSettlementRecoveryRequest },
): BankSettlementLifecycleEffect | null {
  if (!id(scope.organizationId) || !id(scope.companyId) || !id(scope.lineId)) return null
  const scoped = (row: Row) => id(field(row, "organizationId")) === scope.organizationId && id(field(row, "companyId")) === scope.companyId
  const line = exact(rows.lines, scope.lineId)
  if (!line || id(field(line, "organizationId")) !== scope.organizationId) return null
  const statement = exact(rows.statements, id(field(line, "statementId")))
  const attempt = bankSettlementAttempt(line.metadata)
  if (!statement || !scoped(statement) || !["open", "posted"].includes(tag(statement.state)) || !attempt
    || typeof attempt.allocationApplied !== "boolean" || (scope.request && !bankSettlementRecoveryCorrelates(attempt, scope.request))) return null
  const bankAmount = number(line.amount), journalId = id(field(statement, "journalId")), currencyId = id(field(statement, "currencyId"))
  const payment = exact(rows.payments, attempt.paymentId)
  const partnerId = payment && id(field(payment, "partnerId"))
  if (bankAmount == null || bankAmount === 0 || !journalId || !currencyId || !payment || !partnerId || !scoped(payment)
    || id(field(line, "journalId")) !== journalId || id(field(payment, "journalId")) !== journalId
    || id(field(payment, "currencyId")) !== currencyId || !equalAmount(payment.amount, Math.abs(bankAmount))
    || tag(field(payment, "paymentType")) !== (bankAmount > 0 ? "inbound" : "outbound")
    || tag(field(payment, "partnerType")) !== (bankAmount > 0 ? "customer" : "supplier")) return null
  const snapshots = attempt.selectedResiduals
  if (!snapshots || snapshots.length !== attempt.selectedMoveLineIds.length
    || snapshots.some((snapshot) => !snapshot.moveId || snapshot.residualCurrency == null || Math.sign(snapshot.residual) !== Math.sign(bankAmount)
    )
    || !equalAmount(snapshots.reduce((total, snapshot) => total + snapshot.residual, 0), bankAmount)) return null
  const targets: { row: Row; invoice: Row; residual: number; residualCurrency: number }[] = []
  const invoiceResiduals = new Map<string, number>()
  for (const snapshot of attempt.allocationApplied ? snapshots : []) {
    const row = exact(rows.moveLines, snapshot.lineId), invoice = exact(rows.moves, snapshot.moveId)
    if (!row || !invoice || !scoped(row) || !scoped(invoice) || id(field(row, "moveId")) !== snapshot.moveId
      || tag(row.parentState ?? row.parent_state) !== "posted" || tag(invoice.state) !== "posted"
      || tag(field(invoice, "moveType")) !== (bankAmount > 0 ? "outinvoice" : "ininvoice")
      || id(field(row, "partnerId")) !== partnerId || id(field(invoice, "partnerId")) !== partnerId
      || id(field(row, "currencyId")) !== currencyId || id(field(invoice, "currencyId")) !== currencyId
      || tag(field(row, "accountInternalType")) !== (bankAmount > 0 ? "receivable" : "payable")
      || number(row.balance) == null || Math.sign(Number(row.balance)) !== Math.sign(snapshot.residual)
      || Math.abs(snapshot.residual) > Math.abs(Number(row.balance)) + 0.000001
      || number(row.debit) == null || number(row.credit) == null || Number(row.debit) < 0 || Number(row.credit) < 0
      || !equalAmount(Number(row.debit) - Number(row.credit), Number(row.balance))) return null
    targets.push({ row, invoice, residual: snapshot.residual, residualCurrency: snapshot.residualCurrency! })
    invoiceResiduals.set(snapshot.moveId!, (invoiceResiduals.get(snapshot.moveId!) ?? 0) + snapshot.residual)
  }
  const lineMoveIds = ids(field(line, "moveIds")), linePaymentIds = ids(field(line, "paymentIds"))
  const paymentMoveId = id(field(payment, "moveId")), reversalMoveId = id(field(payment, "reversalMoveId"))
  const postedMove = (moveId: string | null): Row | null => {
    const move = exact(rows.moves, moveId)
    return move && scoped(move) && tag(move.state) === "posted" && id(field(move, "journalId")) === journalId && id(field(move, "currencyId")) === currencyId ? move : null
  }
  const originalMove = postedMove(paymentMoveId)
  const originalLines = paymentMoveId ? rows.moveLines.filter((row) => id(field(row, "moveId")) === paymentMoveId) : []
  const clearing = originalLines.filter((row) => ["receivable", "payable"].includes(tag(field(row, "accountInternalType"))))
  const validOriginal = () => originalMove && attempt.paymentMoveId === paymentMoveId && originalLines.length >= 2 && clearing.length > 0
    && ids(originalLines.map((row) => row.id)) != null
    && originalLines.every((row) => scoped(row) && tag(field(row, "parentState")) === "posted" && id(field(row, "accountId")) != null
      && id(field(row, "currencyId")) === currencyId && number(row.debit) != null && Number(row.debit) >= 0 && number(row.credit) != null && Number(row.credit) >= 0)
    && equalAmount(originalLines.reduce((total, row) => total + Number(row.debit), 0), Math.abs(bankAmount))
    && equalAmount(originalLines.reduce((total, row) => total + Number(row.credit), 0), Math.abs(bankAmount))
  const openTargets = () => targets.every(({ row, invoice, residual, residualCurrency }) => equalAmount(field(row, "amountResidual"), residual)
    && equalAmount(field(row, "amountResidualCurrency"), residualCurrency)
    && equalAmount(field(invoice, "amountResidual"), Math.abs(invoiceResiduals.get(String(invoice.id))!))
    && ["notpaid", "partial"].includes(tag(field(invoice, "paymentState"))))
  const settledTargets = () => targets.every(({ row, invoice }) => equalAmount(field(row, "amountResidual"), 0)
    && equalAmount(field(invoice, "amountResidual"), 0) && tag(field(invoice, "paymentState")) === "paid"
    && field(row, "matchingNumber") === `MATCH-${paymentMoveId}-${String(invoice.id)}`)
  const unmatched = () => field(line, "isReconciled") === false && sameIds(lineMoveIds, [])
    && equalAmount(field(line, "amountResidual"), bankAmount)
  const closedDraft = ["approval_rejected", "approval_invalidated", "approval_cancelled"].includes(attempt.status)
  if (attempt.status === "awaiting_approval" || closedDraft) {
    if (attempt.allocationApplied || !unmatched() || !sameIds(linePaymentIds, [attempt.paymentId]) || tag(payment.state) !== "notpaid" || paymentMoveId || reversalMoveId) return null
  } else if (attempt.status === "payment_posted") {
    if (attempt.allocationApplied || !unmatched() || !sameIds(linePaymentIds, [attempt.paymentId]) || tag(payment.state) !== "paid" || reversalMoveId || !validOriginal()
      || !equalAmount(clearing.reduce((total, row) => total + (number(field(row, "amountResidual")) ?? Number.NaN), 0), -bankAmount)) return null
  } else if (attempt.status === "abandoned") {
    if (attempt.allocationApplied || !unmatched() || !sameIds(linePaymentIds, []) || id(field(line, "moveId")) != null || tag(payment.state) !== "reversed" || paymentMoveId || reversalMoveId) return null
  } else if (attempt.status === "reversed") {
    const reversal = postedMove(reversalMoveId), reversalMetadata = reversal && json(reversal.metadata)
    const reversalLines = reversalMoveId ? rows.moveLines.filter((row) => id(field(row, "moveId")) === reversalMoveId) : []
    if (tag(statement.state) !== "open" || !unmatched() || !sameIds(linePaymentIds, []) || id(field(line, "moveId")) != null || tag(payment.state) !== "reversed" || !validOriginal()
      || !reversal || attempt.reversalMoveId !== reversalMoveId || !reversalMetadata
      || timestampMicros(reversal.date) !== attempt.reversalDateMicros
      || id(reversalMetadata.reverses_payment_move_id) !== paymentMoveId || id(reversalMetadata.account_payment_id) !== attempt.paymentId
      || !openTargets() || reversalLines.length !== originalLines.length || ids(reversalLines.map((row) => row.id)) == null
      || clearing.some((row) => !equalAmount(field(row, "amountResidual"), 0))
      || reversalLines.some((row) => !scoped(row) || tag(field(row, "parentState")) !== "posted" || !equalAmount(field(row, "amountResidual"), 0))) return null
    const signature = (row: Row, reverse: boolean) => JSON.stringify([id(field(row, "accountId")), id(field(row, "partnerId")), id(field(row, "currencyId")), number(reverse ? row.credit : row.debit), number(reverse ? row.debit : row.credit)])
    const originals = originalLines.map((row) => signature(row, false)).sort(), reversals = reversalLines.map((row) => signature(row, true)).sort()
    if (originals.some((value, index) => value !== reversals[index])) return null
  } else {
    const stillUnallocated = attempt.status !== "settled" && !attempt.allocationApplied && field(line, "isReconciled") === false
    if (!sameIds(linePaymentIds, [attempt.paymentId]) || tag(payment.state) !== "paid" || reversalMoveId || !validOriginal()) return null
    if (stillUnallocated ? !unmatched() || !equalAmount(clearing.reduce((total, row) => total + (number(field(row, "amountResidual")) ?? Number.NaN), 0), -bankAmount)
      : field(line, "isReconciled") !== true || !sameIds(lineMoveIds, attempt.selectedMoveLineIds) || !equalAmount(field(line, "amountResidual"), 0)
        || !attempt.allocationApplied || !settledTargets() || clearing.some((row) => !equalAmount(field(row, "amountResidual"), 0))) return null
    if (attempt.status === "reversal_awaiting_approval" && (!attempt.reversalRequestId || !attempt.reversalDateMicros || !attempt.recoveryKey)) return null
  }
  return { status: attempt.status, attempt, organizationId: scope.organizationId, companyId: scope.companyId,
    statementId: String(statement.id), lineId: scope.lineId, resource: "bank-statement-lines", id: scope.lineId }
}
