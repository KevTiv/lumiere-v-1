/** Local examples only. Posted amounts and due dates remain server-owned. */
export function taxAmountExample(values: {
  amount?: unknown
  amountType?: unknown
  priceInclude?: unknown
}, enteredAmount: number): { base: number; tax: number; total: number } | null {
  if (values.amount === "" || values.amount == null || values.amountType !== "percent") return null
  const rate = Number(values.amount)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || !Number.isFinite(enteredAmount) || enteredAmount < 0) return null
  const base = values.priceInclude === true ? enteredAmount / (1 + rate / 100) : enteredAmount
  const tax = values.priceInclude === true ? enteredAmount - base : base * rate / 100
  return { base, tax, total: base + tax }
}

interface LedgerMove {
  id?: unknown
  companyId?: unknown
  company_id?: unknown
  state?: unknown
}

interface LedgerLine {
  moveId?: unknown
  move_id?: unknown
  companyId?: unknown
  company_id?: unknown
  debit?: unknown
  credit?: unknown
}

function nonNegativeAmount(value: unknown): number | null {
  if (value === "" || value == null) return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

/** Inspect only the selected current-company draft, never another move with matching text. */
export function proposedLedgerTotals(
  values: { moveId?: unknown; debit?: unknown; credit?: unknown },
  companyId: string,
  moves: readonly LedgerMove[],
  lines: readonly LedgerLine[],
): { debit: number; credit: number; difference: number; lineCount: number } | null {
  const moveId = String(values.moveId ?? "")
  if (!moveId || !companyId || companyId === "0") return null
  const matching = moves.filter((move) => String(move.id) === moveId && String(move.companyId ?? move.company_id ?? "") === companyId)
  if (matching.length !== 1) return null
  const state = matching[0].state
  if ((typeof state === "object" && state !== null && "tag" in state ? state.tag : state) !== "Draft") return null
  const debit = nonNegativeAmount(values.debit)
  const credit = nonNegativeAmount(values.credit)
  if (debit == null || credit == null) return null
  const existing = lines.filter((line) => String(line.moveId ?? line.move_id ?? "") === moveId)
  if (existing.some((line) => String(line.companyId ?? line.company_id ?? "") !== companyId)) return null
  let totalDebit = debit
  let totalCredit = credit
  for (const line of existing) {
    const rowDebit = nonNegativeAmount(line.debit)
    const rowCredit = nonNegativeAmount(line.credit)
    if (rowDebit == null || rowCredit == null) return null
    totalDebit += rowDebit
    totalCredit += rowCredit
  }
  if (!Number.isFinite(totalDebit) || !Number.isFinite(totalCredit)) return null
  return { debit: totalDebit, credit: totalCredit, difference: totalDebit - totalCredit, lineCount: existing.length }
}

/** Simple day offsets only; calendar-month and end-of-month rules need the full schedule. */
export function instalmentDateExample(invoiceDate: string, values: {
  days?: unknown
  months?: unknown
  daysAfterEndOfMonth?: unknown
}): string | null {
  if (Number(values.months ?? 0) !== 0 || values.daysAfterEndOfMonth === true) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null
  const date = new Date(`${invoiceDate}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== invoiceDate) return null
  const days = Number(values.days ?? 0)
  if (!Number.isSafeInteger(days) || days < 0 || days > 36500) return null
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function instalmentAmountExample(invoiceAmount: number, values: {
  value?: unknown
  valueAmount?: unknown
}): number | null {
  if (!Number.isFinite(invoiceAmount) || invoiceAmount < 0 || values.value === "Balance") return null
  const amount = nonNegativeAmount(values.valueAmount)
  if (amount == null) return null
  if (values.value === "Percent" && amount <= 100) return invoiceAmount * amount / 100
  if (values.value === "Fixed") return amount
  return null
}
