import { unwrapSome } from "@lumiere/erp-shared/form-coercion"
import type { ModuleDataState } from "../lib/module-data-state"
import { formatTimestampLike } from "../lib/entity-row-values"

type ScopeId = string | number | bigint
interface ScopedRow { id?: unknown
  organizationId?: unknown
  companyId?: unknown }
export interface ReconciliationStatementSource extends ScopedRow {
  name?: unknown
  reference?: unknown
  state?: unknown
  journalId?: unknown
  currencyId?: unknown
}
export interface ReconciliationBankLineSource {
  id?: unknown
  organizationId?: unknown
  statementId?: unknown
  journalId?: unknown
  date?: unknown
  amount?: unknown
  amountCurrency?: unknown
  currencyId?: unknown
  journalCurrencyId?: unknown
  foreignCurrencyId?: unknown
  isReconciled?: unknown
  partnerId?: unknown
  accountNumber?: unknown
  transactionType?: unknown
  moveIds?: readonly unknown[]
  paymentIds?: readonly unknown[]
  metadata?: unknown
}
export interface ReconciliationMoveLineSource extends ScopedRow {
  moveId?: unknown
  accountId?: unknown
  name?: unknown
  ref?: unknown
  ref_?: unknown
  parentState?: unknown
  companyCurrencyId?: unknown
  currencyId?: unknown
  balance?: unknown
  debit?: unknown
  credit?: unknown
  amountResidual?: unknown
  blocked?: unknown
  partnerId?: unknown
  isMatching?: unknown
  amountCurrency?: unknown
}
export interface ReconciliationMoveSource extends ScopedRow {
  name?: unknown
  ref?: unknown
  state?: unknown
  moveType?: unknown
  partnerId?: unknown
  invoicePartnerDisplayName?: unknown
}
export interface ReconciliationAccountSource extends ScopedRow { name?: unknown
  code?: unknown
  reconcile?: unknown
  deprecated?: unknown
  internalType?: unknown }
export interface ReconciliationCurrencySource { id?: unknown
  name?: unknown
  code?: unknown
  decimalPlaces?: unknown
  roundingFactor?: unknown }
export interface ReconciliationSuggestionSource { entityId?: unknown
  statementLineId?: unknown
  organizationId?: unknown }
export interface ReconciliationTransactionSource extends ScopedRow {
  sourceEntity?: unknown
  sourceEntityId?: unknown
  accountPaymentId?: unknown
  status?: unknown
  partnerId?: unknown
  currencyId?: unknown
  direction?: unknown
  externalReference?: unknown
  grossExternalAmount?: unknown
  settlementAmount?: unknown
  netAccountAmount?: unknown }
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
  transactions?: readonly ReconciliationTransactionSource[]
}
export interface ReconciliationDocumentItem {
  id: string
  moveId: string
  documentLabel: string
  href: string
}
export interface ReconciliationCandidate extends ReconciliationDocumentItem {
  partnerId: string
  accountId: string
  description: string
  partner: string
  accountLabel: string
  amount: number
  suggested: boolean
}
export interface ReconciliationContext {
  key: string
  organizationId: string
  companyId: string
  statementId: string
  lineId: string
  statementLabel: string
  lineLabel: string
  amount: number
  currencyId: string
  currencyCode?: string
  decimalPlaces: number
  dateLabel?: string
  partnerLabel?: string
  journalId?: string
}
export type ReconciliationProjection =
  | { status: "unavailable"; state: ModuleDataState }
  | { status: "blocked"
      message: string
      currencyException?: { context: ReconciliationContext
        foreignCurrencies: string[]
        items: ReconciliationDocumentItem[] } }
  | { status: "ready"
      context: ReconciliationContext
      candidates: ReconciliationCandidate[]
      foreignItems: ReconciliationDocumentItem[] }
export interface ReconciliationRequest {
  readonly organizationId: string
  readonly companyId: string
  readonly statementId: string
  readonly lineId: string
  readonly moveLineIds: readonly string[]
  readonly amountResidual: 0
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
function inScope(row: ScopedRow, organizationId: string, companyId: string,
): boolean {
  return (
    reconciliationId(row.organizationId) === organizationId && reconciliationId(row.companyId) === companyId
  )
}
function uniqueRows<Row extends { id?: unknown }>(rows: readonly Row[],
): Map<string, Row> {
  const result = new Map<string, Row>()
  const duplicate = new Set<string>()
  for (const row of rows) {
    const id = reconciliationId(row.id)
    if (!id || duplicate.has(id)) continue
    if (result.has(id)) { result.delete(id)
      duplicate.add(id) } else result.set(id, row)
  }
  return result
}
function currencyCode(currency: ReconciliationCurrencySource | undefined,
): string | undefined {
  const code = text(currency?.code).trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : undefined
}
function documentItem(id: string, moveId: string, move: ReconciliationMoveSource,
): ReconciliationDocumentItem {
  return { id, moveId, documentLabel: text(move.name).trim() || `Journal entry #${moveId}`, href: `/accounting/invoices/${encodeURIComponent(moveId)}`,
  }
}

/** Recovery context is independent of new-match eligibility and includes posted statements. */
export function reconciliationLifecycleContext(source: ReconciliationSource,
): ReconciliationContext | null {
  if (source.state.status !== "ready") return null
  const organizationId = reconciliationId(source.organizationId), companyId = reconciliationId(source.companyId), currencyId = reconciliationId(source.companyCurrencyId)
  const statement = source.statement, focusedId = reconciliationId(source.line?.id)
  const line = focusedId ? uniqueRows(source.bankLines).get(focusedId) : undefined
  if (!organizationId || !companyId || !currencyId || !statement || !line || !inScope(statement, organizationId, companyId)
    || !["Open", "Posted"].includes(tag(statement.state))) return null
  const statementId = reconciliationId(statement.id), lineId = reconciliationId(line.id), journalId = reconciliationId(statement.journalId)
  const bankAmount = amount(line.amount), currency = uniqueRows(source.currencies).get(currencyId), decimalPlaces = amount(currency?.decimalPlaces)
  if (!statementId || !lineId || !journalId || reconciliationId(line.organizationId) !== organizationId || reconciliationId(line.statementId) !== statementId
    || reconciliationId(line.journalId) !== journalId || bankAmount == null || bankAmount === 0 || decimalPlaces == null
    || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6 || amount(currency?.roundingFactor) !== 10 ** -decimalPlaces
    || minorUnits(bankAmount, decimalPlaces) == null || reconciliationId(statement.currencyId) !== currencyId
    || reconciliationId(line.journalCurrencyId) !== currencyId || !(line.currencyId === null || reconciliationId(line.currencyId) === currencyId)
    || line.foreignCurrencyId !== null) return null
  const code = text(currency?.code).trim().toUpperCase()
  return { key: [organizationId, companyId, statementId, lineId].join(":"), organizationId, companyId, statementId, lineId,
    journalId,
    statementLabel: text(statement.name) || text(statement.reference) || `Statement #${statementId}`, lineLabel: text(line.transactionType) || `Bank line #${lineId}`,
    amount: bankAmount, currencyId, decimalPlaces, ...(/^[A-Z]{3}$/.test(code) ? { currencyCode: code } : {}),
  }
}

/**
 * Exact invoice/bill settlement review. Canonical signed residuals are used only
 * when every amount is in base currency; payment posting uses its approval gate.
 */
export function projectReconciliation(source: ReconciliationSource,
): ReconciliationProjection {
  if (source.state.status !== "ready") return { status: "unavailable", state: source.state }
  const organizationId = reconciliationId(source.organizationId)
  const companyId = reconciliationId(source.companyId)
  const currencyId = reconciliationId(source.companyCurrencyId)
  const statement = source.statement
  if (!source.line || !statement) return { status: "blocked", message: "Choose a statement line to review its possible matches.",
    }
  const focusedId = reconciliationId(source.line.id)
  const line = focusedId ? uniqueRows(source.bankLines).get(focusedId) : undefined
  if (!line) return { status: "blocked", message: "The current bank line is unavailable or ambiguous. Refresh before matching.",
    }
  if (!organizationId || !companyId || !currencyId || !inScope(statement, organizationId, companyId)) return { status: "blocked", message: "The statement’s company or base currency is unavailable. Refresh before matching.",
    }
  const statementId = reconciliationId(statement.id)
  const lineId = reconciliationId(line.id)
  const journalId = reconciliationId(statement.journalId)
  if (!statementId || !lineId || !journalId || reconciliationId(line.organizationId) !== organizationId || reconciliationId(line.statementId) !== statementId || reconciliationId(line.journalId) !== journalId) return { status: "blocked", message: "The bank line does not belong to this statement and company.",
    }
  if (tag(statement.state) !== "Open") return { status: "blocked", message: "Open the statement before matching its lines.",
    }
  if (line.isReconciled !== false) return { status: "blocked", message: line.isReconciled === true ? "This bank line is already matched." : "The bank line’s matching status is unavailable.",
    }
  const bankAmount = amount(line.amount)
  if (bankAmount === null || bankAmount === 0) return { status: "blocked", message: "A known, non-zero bank amount is required. Missing amounts are not treated as zero.",
    }
  const currencies = uniqueRows(source.currencies)
  const currency = currencies.get(currencyId)
  const bankCurrencyId = reconciliationId(line.journalCurrencyId)
  const foreignIds = [...new Set([statement.currencyId, line.journalCurrencyId, line.currencyId, line.foreignCurrencyId,
      ]
    .map(reconciliationId).filter((id): id is string => id !== null && id !== currencyId),
    ),
  ]
  const date = formatTimestampLike(line.date)
  const bankContext = {
    key: [organizationId, companyId, statementId, lineId].join(":"), organizationId, companyId, statementId, lineId,
    journalId,
    statementLabel: text(statement.name) || text(statement.reference) || `Statement #${statementId}`,
    lineLabel: text(line.transactionType) || text(line.accountNumber) || `Bank line #${lineId}`, amount: bankAmount,
    ...(date ? { dateLabel: date.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC",
          }),
        } : {}),
  }
  if (foreignIds.length && bankCurrencyId && reconciliationId(statement.currencyId) && Array.isArray(line.moveIds)
    && line.moveIds.length === 0 && !line.paymentIds?.length) {
    const bankCurrency = currencies.get(bankCurrencyId)
    const precision = amount(bankCurrency?.decimalPlaces)
    const decimalPlaces = precision !== null && Number.isInteger(precision) && precision >= 0 && precision <= 6 ? precision : 6
    // Current references let a selected document survive an FX classification change.
    // They are read-only and never enter the settlement candidate set.
    const moves = uniqueRows(source.moves)
    const items: ReconciliationDocumentItem[] = []
    for (const [id, row] of uniqueRows(source.moveLines)) {
      const moveId = reconciliationId(row.moveId)
      const move = moveId ? moves.get(moveId) : undefined
      if (moveId && move && inScope(row, organizationId, companyId) && inScope(move, organizationId, companyId)
        && tag(move.state) === "Posted" && tag(move.moveType) === (bankAmount > 0 ? "OutInvoice" : "InInvoice")) {
        items.push(documentItem(id, moveId, move))
      }
    }
    return { status: "blocked", message: "This desk supports base-currency matches only. Foreign-currency lines require expert review.", currencyException: {
      context: { ...bankContext, currencyId: bankCurrencyId, currencyCode: currencyCode(bankCurrency), decimalPlaces,
        },
      foreignCurrencies: foreignIds.map((id) => currencyCode(currencies.get(id)) ?? `#${id}`,
        ), items,
    },
    }
  }
  const decimalPlaces = amount(currency?.decimalPlaces)
  if (decimalPlaces === null || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6 || amount(currency?.roundingFactor) !== 10 ** -decimalPlaces) return { status: "blocked", message: "Supported currency precision is unavailable. Expert review is required before matching.",
    }
  const bankMinor = minorUnits(bankAmount, decimalPlaces)
  if (bankMinor === null) return { status: "blocked", message: "The bank amount cannot be represented exactly at this currency’s precision.",
    }
  if (reconciliationId(statement.currencyId) !== currencyId || reconciliationId(line.journalCurrencyId) !== currencyId || !(line.currencyId === null || reconciliationId(line.currencyId) === currencyId) || line.foreignCurrencyId !== null) return { status: "blocked", message: "This desk supports base-currency matches only. Foreign-currency lines require expert review.",
    }
  if (!Array.isArray(line.moveIds) || line.moveIds.length > 0) return { status: "blocked", message: "Existing or unavailable bank links require expert review before making another match.",
    }
  const linkedIds = new Set<string>()
  for (const bankLine of source.bankLines) {
    if (!reconciliationId(bankLine.organizationId)) return { status: "blocked", message: "Existing bank links have incomplete organization scope. Refresh before selecting records.",
      }
    if (reconciliationId(bankLine.organizationId) !== organizationId) continue
    if (!Array.isArray(bankLine.moveIds)) return { status: "blocked", message: "Existing bank links are unavailable. Refresh before selecting records.",
      }
    const isOperational =
      bankLine.isReconciled === true &&
      bankLine.paymentIds?.length === 1 &&
      source.transactions?.some(
        (transaction) =>
          tag(transaction.status) === "Posted" &&
          inScope(transaction, organizationId, companyId) &&
          unwrapSome(transaction.sourceEntity) ===
            "account_bank_statement_line" &&
          reconciliationId(unwrapSome(transaction.sourceEntityId)) ===
            reconciliationId(bankLine.id) &&
          reconciliationId(unwrapSome(transaction.accountPaymentId)) ===
            reconciliationId(bankLine.paymentIds?.[0]),
      )
    if (isOperational) continue
    for (const id of bankLine.moveIds) {
      const exact = reconciliationId(id)
      if (!exact) return { status: "blocked", message: "An existing bank link is incomplete. Refresh before selecting records.",
        }
      linkedIds.add(exact)
    }
  }
  const moves = uniqueRows(source.moves)
  const accounts = uniqueRows(source.accounts)
  const suggestions = new Set((source.suggestions ?? []).filter((row) => reconciliationId(row.organizationId) === organizationId && reconciliationId(row.statementLineId) === lineId,
      ).map((row) => reconciliationId(row.entityId)),
  )
  const candidates: ReconciliationCandidate[] = []
  const foreignItems: ReconciliationDocumentItem[] = []
  for (const [id, row] of uniqueRows(source.moveLines)) {
    if (!inScope(row, organizationId, companyId) || linkedIds.has(id) || row.blocked !== false || row.isMatching === true || tag(row.parentState) !== "Posted") continue
    const itemCurrency = reconciliationId(row.currencyId)
    if (reconciliationId(row.companyCurrencyId) !== currencyId || !itemCurrency) continue
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
    const document = documentItem(id, moveId, move)
    if (itemCurrency !== currencyId) {
      foreignItems.push(document)
      continue
    }
    if (row.amountCurrency != null) {
      const amountCurrency = amount(row.amountCurrency)
      if (amountCurrency == null || minorUnits(amountCurrency, decimalPlaces) !== balanceMinor) continue
    }
    candidates.push({ ...document, partnerId, accountId, description: text(row.name) || text(row.ref) || text(row.ref_) || text(move.ref) || "Journal item", partner: text(move.invoicePartnerDisplayName), accountLabel: [text(account.code), text(account.name)].filter(Boolean).join(" · ") || `Account #${accountId}`, amount: residual, suggested: suggestions.has(id),
    })
  }
  candidates.sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.documentLabel.localeCompare(b.documentLabel) || a.id.localeCompare(b.id),
  )
  foreignItems.sort((a, b) => a.documentLabel.localeCompare(b.documentLabel) || a.id.localeCompare(b.id),
  )
  const partnerId = reconciliationId(line.partnerId)
  const partner = partnerId ? uniqueRows(source.partners ?? []).get(partnerId) : undefined
  const partnerLabel = partner && reconciliationId(partner.organizationId) === organizationId && (partner.companyId === null || reconciliationId(partner.companyId) === companyId) ? text(partner.name) : ""
  return { status: "ready", context: { ...bankContext, currencyId, decimalPlaces, currencyCode: currencyCode(currency), ...(partnerLabel ? { partnerLabel } : {}),
    }, candidates, foreignItems,
  }
}

export type ReconciliationIssue =
  | "stale_selection" | "mixed_partners" | "mixed_accounts" | "incomplete_document" | "foreign_document" | "unavailable_amount" | "short_payment" | "excess_payment"

export function reconciliationSelection(projection: ReconciliationProjection, selectedIds: readonly string[],
) {
  if (projection.status !== "ready") return { selected: [] as ReconciliationCandidate[], total: null, difference: null, request: null, issue: null,
    }
  const selected = projection.candidates.filter((row) => selectedIds.includes(row.id),
  )
  const documents = new Set(selected.map((row) => row.moveId))
  const scale = 10 ** projection.context.decimalPlaces
  const totalMinor = selected.reduce((sum, row) => sum + minorUnits(row.amount, projection.context.decimalPlaces)!, 0,
  )
  const bankMinor = minorUnits(projection.context.amount, projection.context.decimalPlaces,
  )!
  const differenceMinor = bankMinor - totalMinor
  const total = Number.isSafeInteger(totalMinor) ? totalMinor / scale : null
  const difference = Number.isSafeInteger(differenceMinor) ? differenceMinor / scale : null
  let issue: ReconciliationIssue | null = null
  if (selectedIds.length > 0) {
    if (projection.foreignItems.some((row) => documents.has(row.moveId) || selectedIds.includes(row.id),
      )) issue = "foreign_document"
    else if (selected.length !== selectedIds.length || new Set(selectedIds).size !== selectedIds.length) issue = "stale_selection"
    else if (new Set(selected.map((row) => row.partnerId)).size !== 1) issue = "mixed_partners"
    else if (new Set(selected.map((row) => row.accountId)).size !== 1) issue = "mixed_accounts"
    else if (projection.candidates.some((row) => documents.has(row.moveId) && !selectedIds.includes(row.id),
      )) issue = "incomplete_document"
    else if (total === null || difference === null) issue = "unavailable_amount"
    else if (differenceMinor !== 0) issue = Math.abs(totalMinor) > Math.abs(bankMinor) ? "short_payment" : "excess_payment"
  }
  const { organizationId, companyId, statementId, lineId } = projection.context
  const request: ReconciliationRequest | null = selected.length > 0 && issue === null && differenceMinor === 0
    ? { organizationId, companyId, statementId, lineId, moveLineIds: selected.map((row) => row.id), amountResidual: 0,
        }
    : null
  return { selected, total, difference, request, issue }
}

export function bankSettlementTransactions(
  source: ReconciliationSource,
  context: ReconciliationContext,
  partnerId?: string,
) {
  const bankMinor = minorUnits(Math.abs(context.amount), context.decimalPlaces)
  if (bankMinor === null || bankMinor <= 0) return []
  const line = uniqueRows(source.bankLines).get(context.lineId)
  return [...uniqueRows(source.transactions ?? []).entries()].flatMap(
    ([id, transaction]) => {
      const reference = text(unwrapSome(transaction.externalReference)).trim()
      const paymentId = reconciliationId(
        unwrapSome(transaction.accountPaymentId),
      )
      const status = tag(transaction.status)
      if (
        !inScope(transaction, context.organizationId, context.companyId) ||
        unwrapSome(transaction.sourceEntity) !==
          "account_bank_statement_line" ||
        reconciliationId(unwrapSome(transaction.sourceEntityId)) !==
          context.lineId ||
        reconciliationId(transaction.currencyId) !== context.currencyId ||
        tag(transaction.direction) !==
          (context.amount > 0 ? "Inbound" : "Outbound") ||
        (partnerId && reconciliationId(transaction.partnerId) !== partnerId) ||
        (status !== "Draft" && status !== "Posted") ||
        (status === "Posted" && (!paymentId || !reference)) ||
        (line?.isReconciled === true &&
          (line.paymentIds?.length !== 1 ||
            reconciliationId(line.paymentIds[0]) !== paymentId)) ||
        [
          transaction.grossExternalAmount,
          transaction.settlementAmount,
          transaction.netAccountAmount,
        ].some((value) => {
          const parsed = amount(value)
          return (
            parsed === null ||
            minorUnits(parsed, context.decimalPlaces) !== bankMinor
          )
        })
      )
        return []
      return [
        {
          id,
          paymentId,
          reference,
          status,
          partnerId: reconciliationId(transaction.partnerId),
        },
      ]
    },
  )
}
