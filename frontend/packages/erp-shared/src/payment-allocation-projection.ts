import { parseStrictU64 } from "./u64"
import { unwrapSome } from "./form-coercion"

/** Structural read boundary; optional fields are checked before balances are exposed. */
export interface PaymentAllocationRow {
  id?: unknown
  organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown
  currencyId?: unknown; currency_id?: unknown
  companyCurrencyId?: unknown; company_currency_id?: unknown
  partnerId?: unknown; partner_id?: unknown
  moveId?: unknown; move_id?: unknown
  paymentId?: unknown; payment_id?: unknown
  accountPaymentId?: unknown; account_payment_id?: unknown
  originalTransactionId?: unknown; original_transaction_id?: unknown
  correctingTransactionId?: unknown; correcting_transaction_id?: unknown
  originalAccountPaymentId?: unknown; original_account_payment_id?: unknown
  correctingAccountPaymentId?: unknown; correcting_account_payment_id?: unknown
  sourceEntity?: unknown; source_entity?: unknown
  sourceEntityId?: unknown; source_entity_id?: unknown
  paymentType?: unknown; payment_type?: unknown
  direction?: unknown
  state?: unknown; status?: unknown
  parentState?: unknown; parent_state?: unknown
  accountInternalType?: unknown; account_internal_type?: unknown
  amount?: unknown; balance?: unknown
  amountResidual?: unknown; amount_residual?: unknown
  settlementAmount?: unknown; settlement_amount?: unknown
  decimalPlaces?: unknown; decimal_places?: unknown
}

export type PaymentAllocationState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "denied" | "partial" | "error"; message?: string; onRetry?: () => void }

export interface PaymentAllocationCollection {
  rows: readonly PaymentAllocationRow[]
  state: PaymentAllocationState
}

export interface PaymentAllocationSources {
  organizationId: bigint | number | string
  companyId: bigint | number | string
  payments: PaymentAllocationCollection
  moves: PaymentAllocationCollection
  moveLines: PaymentAllocationCollection
  transactions: PaymentAllocationCollection
  reversals: PaymentAllocationCollection
  currencies: PaymentAllocationCollection
}

export interface PaymentAllocationBalance {
  paymentId: string
  transactionId?: string
  currencyId: string
  decimalPlaces: number
  amountMinor: bigint
  allocatedMinor: bigint
  remainingMinor: bigint
  row: PaymentAllocationRow
}

export interface PaymentAllocationProjection {
  state: PaymentAllocationState
  rows: readonly PaymentAllocationBalance[]
}

function field(row: PaymentAllocationRow, camel: keyof PaymentAllocationRow, snake: keyof PaymentAllocationRow): unknown {
  return row[camel] ?? row[snake]
}

function key(value: unknown): string {
  const parsed = parseStrictU64(value)
  return parsed != null && parsed > 0n ? String(parsed) : ""
}

function tag(value: unknown): string {
  const unwrapped = unwrapSome(value)
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    const record = unwrapped as Record<string, unknown>
    return tag(record.tag ?? (Object.keys(record).length === 1 ? Object.keys(record)[0] : ""))
  }
  return typeof unwrapped === "string" ? unwrapped.replace(/[^a-z]/gi, "").toLowerCase() : ""
}

/** Parse money to safe minor units; tolerate only binary floating-point representation noise. */
export function paymentMoneyMinor(value: unknown, decimalPlaces: number): bigint | null {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return null
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    const scaled = value * 10 ** decimalPlaces
    const rounded = Math.round(scaled)
    // Persisted f64 residuals can contain cancellation noise after subtraction
    // (100 - 99.99). The fixed millionth of a minor unit never grows with the
    // amount; ambiguous large-number precision fails instead of widening it.
    const tolerance = 0.000001
    if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > tolerance) return null
    return BigInt(rounded)
  }
  if (typeof value !== "string" && typeof value !== "bigint") return null
  const text = String(value)
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null
  const fraction = (match[3] ?? "").replace(/0+$/, "")
  if (fraction.length > decimalPlaces) return null
  const minor = (BigInt(match[2]!) * 10n ** BigInt(decimalPlaces) + BigInt(fraction.padEnd(decimalPlaces, "0") || "0")) * (match[1] ? -1n : 1n)
  return minor >= -BigInt(Number.MAX_SAFE_INTEGER) && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? minor : null
}

/** Keep exact cents intact when formatting; never round a large bigint through Number. */
export function paymentMinorUnitsText(minor: bigint, decimalPlaces: number, locale?: string): string {
  const negative = minor < 0n
  const absolute = negative ? -minor : minor
  const scale = 10n ** BigInt(decimalPlaces)
  const whole = (absolute / scale).toLocaleString(locale)
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? "."
  return `${negative ? "-" : ""}${whole}${decimalPlaces ? `${decimal}${String(absolute % scale).padStart(decimalPlaces, "0")}` : ""}`
}

function partial(message: string): PaymentAllocationProjection {
  return { rows: [], state: { status: "partial", message } }
}

/**
 * The payment's posted receivable/payable clearing lines are the authoritative
 * residual for both operational allocations and legacy invoice registration.
 * Invoice link arrays and reconciliation history are deliberately not added to
 * those balances: doing so counts the same allocation twice.
 */
export function projectPaymentAllocations(sources: PaymentAllocationSources): PaymentAllocationProjection {
  const collections = [sources.payments, sources.moves, sources.moveLines, sources.transactions, sources.reversals, sources.currencies]
  const states = collections.map((collection) => collection.state)
  const unavailable = states.find((state) => state.status === "denied")
    ?? states.find((state) => state.status === "error")
    ?? states.find((state) => state.status === "partial")
    ?? states.find((state) => state.status === "loading")
  if (unavailable) return { rows: [], state: unavailable }
  const organizationId = key(sources.organizationId)
  const companyId = key(sources.companyId)
  if (!organizationId || !companyId) return partial("Choose an organization and company to calculate payment balances.")

  const scoped = (collection: PaymentAllocationCollection): PaymentAllocationRow[] | null => {
    const result: PaymentAllocationRow[] = []
    const ids = new Set<string>()
    for (const row of collection.rows) {
      const org = key(field(row, "organizationId", "organization_id"))
      const company = key(field(row, "companyId", "company_id"))
      if ((org && org !== organizationId) || (company && company !== companyId)) continue
      const id = key(row.id)
      if (!org || !company || !id || ids.has(id)) return null
      ids.add(id)
      result.push(row)
    }
    return result
  }
  const payments = scoped(sources.payments)
  const moves = scoped(sources.moves)
  const lines = scoped(sources.moveLines)
  const transactions = scoped(sources.transactions)
  const reversals = scoped(sources.reversals)
  if (!payments || !moves || !lines || !transactions || !reversals) return partial("Payment allocation data contains duplicate, missing, or unscoped records.")
  const paymentsById = new Map(payments.map((row) => [key(row.id), row]))
  const movesById = new Map(moves.map((row) => [key(row.id), row]))
  const transactionsById = new Map(transactions.map((row) => [key(row.id), row]))
  const currencies = new Map<string, number | null>()
  for (const row of sources.currencies.rows) {
    const currencyId = key(row.id)
    const precision = field(row, "decimalPlaces", "decimal_places")
    if (!currencyId) continue
    currencies.set(currencyId, currencies.has(currencyId) || typeof precision !== "number" || !Number.isInteger(precision) || precision < 0 || precision > 6 ? null : precision)
  }
  const transactionByPayment = new Map<string, PaymentAllocationRow>()
  const excludedPayments = new Set<string>()
  const reversedOriginals = new Set<string>()
  const correctingTransactions = new Set<string>()
  for (const row of reversals) {
    const originalId = key(field(row, "originalTransactionId", "original_transaction_id"))
    const correctingId = key(field(row, "correctingTransactionId", "correcting_transaction_id"))
    const originalPaymentId = key(field(row, "originalAccountPaymentId", "original_account_payment_id"))
    const correctingPaymentId = key(field(row, "correctingAccountPaymentId", "correcting_account_payment_id"))
    const original = transactionsById.get(originalId)
    const correcting = transactionsById.get(correctingId)
    if (!original || !correcting || originalId === correctingId || !originalPaymentId || !correctingPaymentId || originalPaymentId === correctingPaymentId
      || reversedOriginals.has(originalId) || correctingTransactions.has(correctingId)
      || tag(original.status) !== "reversed" || tag(correcting.status) !== "posted"
      || key(field(original, "accountPaymentId", "account_payment_id")) !== originalPaymentId
      || key(field(correcting, "accountPaymentId", "account_payment_id")) !== correctingPaymentId
      || tag(field(correcting, "sourceEntity", "source_entity")) !== "reversal"
      || key(field(correcting, "sourceEntityId", "source_entity_id")) !== originalId
      || !paymentsById.has(originalPaymentId) || !paymentsById.has(correctingPaymentId)) return partial("Payment reversal records are incomplete or inconsistent.")
    const currencyId = key(field(original, "currencyId", "currency_id"))
    const precision = currencies.get(currencyId)
    const originalDirection = tag(original.direction)
    const originalAmount = precision == null ? null : paymentMoneyMinor(field(original, "settlementAmount", "settlement_amount"), precision)
    if (precision == null || originalAmount == null || originalAmount <= 0n
      || key(field(correcting, "currencyId", "currency_id")) !== currencyId
      || !key(field(original, "partnerId", "partner_id"))
      || key(field(original, "partnerId", "partner_id")) !== key(field(correcting, "partnerId", "partner_id"))
      || !["inbound", "outbound"].includes(originalDirection)
      || tag(correcting.direction) !== (originalDirection === "inbound" ? "outbound" : "inbound")
      || paymentMoneyMinor(field(correcting, "settlementAmount", "settlement_amount"), precision) !== originalAmount
      || paymentMoneyMinor(paymentsById.get(originalPaymentId)?.amount, precision) !== originalAmount
      || paymentMoneyMinor(paymentsById.get(correctingPaymentId)?.amount, precision) !== originalAmount
      || key(field(paymentsById.get(originalPaymentId)!, "currencyId", "currency_id")) !== currencyId
      || key(field(paymentsById.get(correctingPaymentId)!, "currencyId", "currency_id")) !== currencyId) return partial("A payment correction does not offset the original payment in the same currency.")
    reversedOriginals.add(originalId)
    correctingTransactions.add(correctingId)
    excludedPayments.add(originalPaymentId)
    excludedPayments.add(correctingPaymentId)
  }
  for (const transaction of transactions) {
    const status = tag(transaction.status)
    if (!["draft", "posted", "reversed", "voided"].includes(status)) return partial("Payment transaction status is unavailable.")
    const paymentId = key(field(transaction, "accountPaymentId", "account_payment_id"))
    if (status === "draft" || status === "voided") {
      if (paymentId) return partial("An unposted transaction unexpectedly links to a ledger payment.")
      continue
    }
    if (!paymentId || !paymentsById.has(paymentId) || transactionByPayment.has(paymentId)) return partial("A posted transaction has a missing or duplicate ledger payment.")
    if ((status === "reversed" && !reversedOriginals.has(key(transaction.id)))
      || (tag(field(transaction, "sourceEntity", "source_entity")) === "reversal" && !correctingTransactions.has(key(transaction.id)))) return partial("A reversed payment has no complete correction record.")
    transactionByPayment.set(paymentId, transaction)
  }

  const rows: PaymentAllocationBalance[] = []
  const usedMoves = new Set<string>()
  for (const payment of payments) {
    const paymentId = key(payment.id)
    const state = tag(payment.state)
    const direction = tag(field(payment, "paymentType", "payment_type"))
    if (!["notpaid", "paid", "reversed"].includes(state) || !["inbound", "outbound", "transfer"].includes(direction)) return partial("Payment state or direction is unavailable.")
    if (state !== "paid" || direction === "transfer" || excludedPayments.has(paymentId)) continue
    const moveId = key(field(payment, "moveId", "move_id"))
    const move = movesById.get(moveId)
    const currencyId = key(field(payment, "currencyId", "currency_id"))
    const precision = currencies.get(currencyId)
    const partnerId = key(field(payment, "partnerId", "partner_id"))
    if (!move || usedMoves.has(moveId) || tag(move.state) !== "posted" || !partnerId || precision == null
      || key(field(move, "currencyId", "currency_id")) !== currencyId) return partial("A posted payment is missing its unique posted ledger move, partner, or currency.")
    usedMoves.add(moveId)
    const amount = paymentMoneyMinor(payment.amount, precision)
    if (amount == null || amount <= 0n) return partial("Payment amounts exceed safe currency precision or are unavailable.")
    const transaction = transactionByPayment.get(paymentId)
    if (transaction && (key(field(transaction, "currencyId", "currency_id")) !== currencyId
      || key(field(transaction, "partnerId", "partner_id")) !== partnerId
      || tag(transaction.direction) !== direction
      || paymentMoneyMinor(field(transaction, "settlementAmount", "settlement_amount"), precision) !== amount)) return partial("The operational payment does not match its ledger payment.")
    // The original clearing total must equal the payment amount, so redacted or
    // missing clearing roles cannot silently omit part of a split balance.
    const moveLines = lines.filter((line) => key(field(line, "moveId", "move_id")) === moveId)
    if (!moveLines.length) return partial("Payment ledger lines are unavailable.")
    let clearingCount = 0
    let originalMinor = 0n
    let remainingMinor = 0n
    for (const line of moveLines) {
      const role = tag(field(line, "accountInternalType", "account_internal_type"))
      if (!["receivable", "payable", "assetreceivable", "liabilitypayable"].includes(role)) continue
      clearingCount += 1
      const balance = paymentMoneyMinor(line.balance, precision)
      const residual = paymentMoneyMinor(field(line, "amountResidual", "amount_residual"), precision)
      if (tag(field(line, "parentState", "parent_state")) !== "posted"
        || key(field(line, "paymentId", "payment_id")) !== paymentId
        || key(field(line, "partnerId", "partner_id")) !== partnerId
        || key(field(line, "currencyId", "currency_id")) !== currencyId
        || key(field(line, "companyCurrencyId", "company_currency_id")) !== currencyId
        || balance == null || residual == null) return partial("Payment clearing lines have incomplete or incompatible ledger scope and currency.")
      const absoluteBalance = balance < 0n ? -balance : balance
      const absoluteResidual = residual < 0n ? -residual : residual
      if (absoluteResidual > absoluteBalance) return partial("Payment clearing residual exceeds its original balance.")
      originalMinor += absoluteBalance
      remainingMinor += absoluteResidual
    }
    if (!clearingCount || originalMinor !== amount || remainingMinor > amount) return partial("Payment clearing lines do not reconcile to the payment amount.")
    rows.push({ paymentId, ...(transaction ? { transactionId: key(transaction.id) } : {}), currencyId, decimalPlaces: precision,
      amountMinor: amount, allocatedMinor: amount - remainingMinor, remainingMinor, row: payment })
  }
  return { rows, state: { status: "ready" } }
}
