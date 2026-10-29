import type { HumanTaskRow } from "@lumiere/query-hooks/hooks/approvals"

export interface ApprovalSourceRow {
  id?: unknown; organizationId?: unknown; organization_id?: unknown; companyId?: unknown; company_id?: unknown
  name?: unknown; reference?: unknown; ref?: unknown; code?: unknown
  partnerName?: unknown; partner_name?: unknown; invoicePartnerDisplayName?: unknown; invoice_partner_display_name?: unknown
  employeeName?: unknown; employee_name?: unknown; currencyId?: unknown; currency_id?: unknown
  amountTotal?: unknown; amount_total?: unknown; totalAmount?: unknown; total_amount?: unknown; amount?: unknown
}
export interface ApprovalCurrency { id?: unknown; code?: unknown }

export function approvalSourceResource(model: string): { resource: string; permission: string } | null {
  switch (model) {
    case "purchase_order": return { resource: "purchase-orders", permission: "purchase_order" }
    case "sale_order": return { resource: "sale-orders", permission: "sale_order" }
    case "account_move": return { resource: "account-moves", permission: "account_move" }
    case "account_payment": return { resource: "account-payments", permission: "payment" }
    case "payment_transaction": return { resource: "payment-transactions", permission: "payment_transaction" }
    case "hr_expense_sheet":
    case "expense_sheet": return { resource: "expense-sheets", permission: "hr_expense_sheet" }
    default: return null
  }
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined

/** A single exact authorized record, never a title inferred from another row or private workflow payload. */
export function approvalSourceSummary(rows: readonly ApprovalSourceRow[], subjectId: string, organizationId: number, companyId: number, currencies: readonly ApprovalCurrency[], locale: string) {
  const matches = rows.filter((row) => String(row.id) === subjectId && String(row.organizationId ?? row.organization_id) === String(organizationId)
    && String(row.companyId ?? row.company_id) === String(companyId))
  if (matches.length !== 1) return null
  const row = matches[0]
  const reference = text(row.name) ?? text(row.reference) ?? text(row.ref) ?? text(row.code)
  const party = text(row.partnerName) ?? text(row.partner_name) ?? text(row.invoicePartnerDisplayName) ?? text(row.invoice_partner_display_name) ?? text(row.employeeName) ?? text(row.employee_name)
  const currencyId = row.currencyId ?? row.currency_id
  const currencyMatches = currencyId == null ? [] : currencies.filter((currency) => String(currency.id) === String(currencyId))
  const currencyCode = currencyMatches.length === 1 ? text(currencyMatches[0].code) : undefined
  const rawAmount = row.amountTotal ?? row.amount_total ?? row.totalAmount ?? row.total_amount ?? row.amount
  const amount = rawAmount !== "" && (typeof rawAmount === "string" || typeof rawAmount === "number") ? Number(rawAmount) : NaN
  const money = currencyCode && /^[A-Z]{3}$/.test(currencyCode) && Number.isFinite(amount)
    ? new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode, currencyDisplay: "code" }).format(amount) : undefined
  return { reference, party, money }
}

/** Only an explicitly projected, named guarded action supplies an effect label. */
export function approvalRequestedEffect(row: HumanTaskRow): string | null {
  const raw = (row.guardedAction ?? row.guarded_action)?.key
  const key = typeof raw === "string" ? raw : raw && typeof raw === "object" && "tag" in raw && typeof raw.tag === "string" ? raw.tag : undefined
  switch (key) {
    case "ConfirmPurchaseOrder": return "Confirm the purchase order"
    case "SendPurchaseOrder": return "Send the purchase order"
    case "ConfirmSalesOrder": return "Confirm the sales order"
    case "PostAccountMove": return "Post the accounting document"
    case "PostPayment": return "Post the payment"
    case "ApproveExpenseSheet": return "Approve the expense report"
    case "ReverseBankStatementSettlement": return "Reverse the bank settlement"
    default: return null
  }
}
