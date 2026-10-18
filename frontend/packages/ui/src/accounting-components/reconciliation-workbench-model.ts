import type { ModuleDataState } from "../lib/module-data-state"
import { formatTimestampLike } from "../lib/entity-row-values"

type ScopeId = string | number | bigint
interface ScopedRow { id?: unknown; organizationId?: unknown; companyId?: unknown }
export interface ReconciliationStatementSource extends ScopedRow {
  name?: unknown; reference?: unknown; state?: unknown; journalId?: unknown; currencyId?: unknown
}
export interface ReconciliationBankLineSource {
  id?: unknown; organizationId?: unknown; statementId?: unknown; journalId?: unknown
  date?: unknown; amount?: unknown; amountCurrency?: unknown; currencyId?: unknown
  journalCurrencyId?: unknown; foreignCurrencyId?: unknown; isReconciled?: unknown
  partnerId?: unknown; accountNumber?: unknown; transactionType?: unknown; moveIds?: readonly unknown[]
}
export interface ReconciliationMoveLineSource extends ScopedRow {
  moveId?: unknown; accountId?: unknown; name?: unknown; ref?: unknown; ref_?: unknown
  parentState?: unknown; companyCurrencyId?: unknown; currencyId?: unknown
  balance?: unknown; debit?: unknown; credit?: unknown; amountResidual?: unknown; blocked?: unknown; partnerId?: unknown
}
export interface ReconciliationMoveSource extends ScopedRow {
  name?: unknown; ref?: unknown; state?: unknown; moveType?: unknown; partnerId?: unknown; invoicePartnerDisplayName?: unknown
}
export interface ReconciliationAccountSource extends ScopedRow { name?: unknown; code?: unknown; reconcile?: unknown; deprecated?: unknown; internalType?: unknown }
export interface ReconciliationCurrencySource { id?: unknown; name?: unknown; code?: unknown; decimalPlaces?: unknown; roundingFactor?: unknown }
export interface ReconciliationSuggestionSource { entityId?: unknown; statementLineId?: unknown; organizationId?: unknown }
export interface ReconciliationPartnerSource extends ScopedRow { name?: unknown }
export interface ReconciliationSource {
  organizationId: ScopeId
  companyId: ScopeId
  companyCurrencyId: unknown
  state: ModuleDataState
  statement: ReconciliationStatementSource | null
  line: ReconciliationBankLineSource | null
  bankLines: readonly ReconciliationBankLineSource[]
  moveLines: readonly ReconciliationMoveLineSource[]
  moves: readonly ReconciliationMoveSource[]
  accounts: readonly ReconciliationAccountSource[]
  currencies: readonly ReconciliationCurrencySource[]
  suggestions?: readonly ReconciliationSuggestionSource[]
  partners?: readonly ReconciliationPartnerSource[]
}
export interface ReconciliationCandidate {
  id: string; moveId: string; partnerId: string; accountId: string; documentLabel: string; description: string; partner: string
  accountLabel: string; amount: number; suggested: boolean; href: string
}
export interface ReconciliationContext {
  key: string; organizationId: string; companyId: string; statementId: string; lineId: string
  statementLabel: string; lineLabel: string; amount: number; currencyId: string; currencyCode?: string; decimalPlaces: number
  dateLabel?: string; partnerLabel?: string
}
export type ReconciliationProjection =
  | { status: "unavailable"; state: ModuleDataState }
  | { status: "blocked"; message: string }
  | { status: "ready"; context: ReconciliationContext; candidates: ReconciliationCandidate[] }
export interface ReconciliationRequest {
  readonly organizationId: string; readonly companyId: string; readonly statementId: string; readonly lineId: string
  readonly moveLineIds: readonly string[]; readonly amountResidual: 0
}

/** Exact tenant-local IDs never pass through lossy Number coercion. */
export function reconciliationId(value: unknown): string | null {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null
  const id = String(value)
  return /^[1-9]\d*$/.test(id) && BigInt(id) <= 18446744073709551615n ? id : null
}
function amount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function text(value: unknown): string { return typeof value === "string" ? value : "" }
function minorUnits(value: number, decimalPlaces: number): number | null {
  const scaled = value * 10 ** decimalPlaces
  const integer = Math.round(scaled)
  return Number.isSafeInteger(integer) && Math.abs(integer - scaled) <= 0.000001 ? integer : null
}
function tag(value: unknown): string {
  if (typeof value === "string") return value
  return value != null && typeof value === "object" && "tag" in value ? text(value.tag) : ""
}
function inScope(row: ScopedRow, organizationId: string, companyId: string): boolean {
  return reconciliationId(row.organizationId) === organizationId && reconciliationId(row.companyId) === companyId
}
function uniqueRows<Row extends { id?: unknown }>(rows: readonly Row[]): Map<string, Row> {
  const result = new Map<string, Row>()
  const duplicate = new Set<string>()
  for (const row of rows) {
    const id = reconciliationId(row.id)
    if (!id || duplicate.has(id)) continue
    if (result.has(id)) { result.delete(id); duplicate.add(id) } else result.set(id, row)
  }
  return result
}

/**
 * Exact invoice/bill settlement review. Canonical signed residuals are used only
 * when every amount is in base currency; payment posting uses its approval gate.
 */
export function projectReconciliation(source: ReconciliationSource): ReconciliationProjection {
  if (source.state.status !== "ready") return { status: "unavailable", state: source.state }
  const organizationId = reconciliationId(source.organizationId)
  const companyId = reconciliationId(source.companyId)
  const currencyId = reconciliationId(source.companyCurrencyId)
  const statement = source.statement
  if (!source.line || !statement) return { status: "blocked", message: "Choose a statement line to review its possible matches." }
  const focusedId = reconciliationId(source.line.id)
  const line = focusedId ? uniqueRows(source.bankLines).get(focusedId) : undefined
  if (!line) return { status: "blocked", message: "The current bank line is unavailable or ambiguous. Refresh before matching." }
  if (!organizationId || !companyId || !currencyId || !inScope(statement, organizationId, companyId)) return { status: "blocked", message: "The statement’s company or base currency is unavailable. Refresh before matching." }
  const statementId = reconciliationId(statement.id)
  const lineId = reconciliationId(line.id)
  const journalId = reconciliationId(statement.journalId)
  if (!statementId || !lineId || !journalId || reconciliationId(line.organizationId) !== organizationId || reconciliationId(line.statementId) !== statementId || reconciliationId(line.journalId) !== journalId) return { status: "blocked", message: "The bank line does not belong to this statement and company." }
  if (tag(statement.state) !== "Open") return { status: "blocked", message: "Open the statement before matching its lines." }
  if (line.isReconciled !== false) return { status: "blocked", message: line.isReconciled === true ? "This bank line is already matched." : "The bank line’s matching status is unavailable." }
  const bankAmount = amount(line.amount)
  if (bankAmount === null || bankAmount === 0) return { status: "blocked", message: "A known, non-zero bank amount is required. Missing amounts are not treated as zero." }
  const currency = uniqueRows(source.currencies).get(currencyId)
  const decimalPlaces = amount(currency?.decimalPlaces)
  if (decimalPlaces === null || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6 || amount(currency?.roundingFactor) !== 10 ** -decimalPlaces) return { status: "blocked", message: "Supported currency precision is unavailable. Expert review is required before matching." }
  const bankMinor = minorUnits(bankAmount, decimalPlaces)
  if (bankMinor === null) return { status: "blocked", message: "The bank amount cannot be represented exactly at this currency’s precision." }
  if (reconciliationId(statement.currencyId) !== currencyId || reconciliationId(line.journalCurrencyId) !== currencyId || !(line.currencyId === null || reconciliationId(line.currencyId) === currencyId) || line.foreignCurrencyId !== null) return { status: "blocked", message: "This desk supports base-currency matches only. Foreign-currency lines require expert review." }
  if (!Array.isArray(line.moveIds) || line.moveIds.length > 0) return { status: "blocked", message: "Existing or unavailable bank links require expert review before making another match." }
  const linkedIds = new Set<string>()
  for (const bankLine of source.bankLines) {
    if (!reconciliationId(bankLine.organizationId)) return { status: "blocked", message: "Existing bank links have incomplete organization scope. Refresh before selecting records." }
    if (reconciliationId(bankLine.organizationId) !== organizationId) continue
    if (!Array.isArray(bankLine.moveIds)) return { status: "blocked", message: "Existing bank links are unavailable. Refresh before selecting records." }
    for (const id of bankLine.moveIds) {
      const exact = reconciliationId(id)
      if (!exact) return { status: "blocked", message: "An existing bank link is incomplete. Refresh before selecting records." }
      linkedIds.add(exact)
    }
  }
  const moves = uniqueRows(source.moves)
  const accounts = uniqueRows(source.accounts)
  const suggestions = new Set((source.suggestions ?? []).filter((row) => reconciliationId(row.organizationId) === organizationId && reconciliationId(row.statementLineId) === lineId).map((row) => reconciliationId(row.entityId)))
  const candidates: ReconciliationCandidate[] = []
  for (const [id, row] of uniqueRows(source.moveLines)) {
    if (!inScope(row, organizationId, companyId) || linkedIds.has(id) || row.blocked !== false || tag(row.parentState) !== "Posted") continue
    if (reconciliationId(row.companyCurrencyId) !== currencyId || reconciliationId(row.currencyId) !== currencyId) continue
    const moveId = reconciliationId(row.moveId)
    const accountId = reconciliationId(row.accountId)
    const move = moveId ? moves.get(moveId) : undefined
    const account = accountId ? accounts.get(accountId) : undefined
    const partnerId = reconciliationId(move?.partnerId)
    if (!moveId || !accountId || !move || !inScope(move, organizationId, companyId) || tag(move.state) !== "Posted" || !account || !inScope(account, organizationId, companyId) || account.reconcile !== true || account.deprecated !== false
      || tag(move.moveType) !== (bankAmount > 0 ? "OutInvoice" : "InInvoice")
      || tag(account.internalType).toLowerCase() !== (bankAmount > 0 ? "receivable" : "payable")
      || !partnerId || reconciliationId(row.partnerId) !== partnerId
      || (line.partnerId != null && reconciliationId(line.partnerId) !== partnerId)) continue
    const balance = amount(row.balance), debit = amount(row.debit), credit = amount(row.credit), residual = amount(row.amountResidual)
    if (balance === null || debit === null || credit === null || residual === null || debit < 0 || credit < 0 || residual === 0 || Math.sign(residual) !== Math.sign(bankAmount) || Math.sign(residual) !== Math.sign(balance)) continue
    const balanceMinor = minorUnits(balance, decimalPlaces), debitMinor = minorUnits(debit, decimalPlaces), creditMinor = minorUnits(credit, decimalPlaces), residualMinor = minorUnits(residual, decimalPlaces)
    if (balanceMinor === null || debitMinor === null || creditMinor === null || residualMinor === null || debitMinor - creditMinor !== balanceMinor || Math.abs(residualMinor) > Math.abs(balanceMinor)) continue
    const documentLabel = text(move.name).trim() || `Journal entry #${moveId}`
    candidates.push({ id, moveId, partnerId, accountId, documentLabel, description: text(row.name) || text(row.ref) || text(row.ref_) || text(move.ref) || "Journal item", partner: text(move.invoicePartnerDisplayName), accountLabel: [text(account.code), text(account.name)].filter(Boolean).join(" · ") || `Account #${accountId}`, amount: residual, suggested: suggestions.has(id), href: `/accounting/invoices/${encodeURIComponent(moveId)}` })
  }
  candidates.sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.documentLabel.localeCompare(b.documentLabel) || a.id.localeCompare(b.id))
  const code = text(currency?.code).trim().toUpperCase()
  const partnerId = reconciliationId(line.partnerId)
  const partner = partnerId ? uniqueRows(source.partners ?? []).get(partnerId) : undefined
  const partnerLabel = partner && reconciliationId(partner.organizationId) === organizationId && (partner.companyId === null || reconciliationId(partner.companyId) === companyId) ? text(partner.name) : ""
  const date = formatTimestampLike(line.date)
  return { status: "ready", context: { key: [organizationId, companyId, statementId, lineId].join(":"), organizationId, companyId, statementId, lineId, statementLabel: text(statement.name) || text(statement.reference) || `Statement #${statementId}`, lineLabel: text(line.transactionType) || text(line.accountNumber) || `Bank line #${lineId}`, amount: bankAmount, currencyId, decimalPlaces, ...(/^[A-Z]{3}$/.test(code) ? { currencyCode: code } : {}), ...(date ? { dateLabel: date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" }) } : {}), ...(partnerLabel ? { partnerLabel } : {}) }, candidates }
}

export function reconciliationSelection(projection: ReconciliationProjection, selectedIds: readonly string[]) {
  if (projection.status !== "ready") return { selected: [] as ReconciliationCandidate[], total: null, difference: null, request: null }
  const selected = projection.candidates.filter((row) => selectedIds.includes(row.id))
  const valid = selected.length > 0 && selected.length === selectedIds.length && new Set(selectedIds).size === selectedIds.length
    && new Set(selected.map((row) => row.partnerId)).size === 1
    && new Set(selected.map((row) => row.accountId)).size === 1
    && projection.candidates.every((row) => !selected.some((chosen) => chosen.moveId === row.moveId) || selectedIds.includes(row.id))
  const scale = 10 ** projection.context.decimalPlaces
  const totalMinor = selected.reduce((sum, row) => sum + minorUnits(row.amount, projection.context.decimalPlaces)!, 0)
  const differenceMinor = minorUnits(projection.context.amount, projection.context.decimalPlaces)! - totalMinor
  const total = Number.isSafeInteger(totalMinor) ? totalMinor / scale : null
  const difference = Number.isSafeInteger(differenceMinor) ? differenceMinor / scale : null
  const { organizationId, companyId, statementId, lineId } = projection.context
  const request: ReconciliationRequest | null = valid && total !== null && differenceMinor === 0
    ? { organizationId, companyId, statementId, lineId, moveLineIds: selected.map((row) => row.id), amountResidual: 0 }
    : null
  return { selected, total, difference, request }
}
