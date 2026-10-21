import { describe, expect, it } from "vitest"
import type { AccountMove } from "../lib/accounting-types"
import { accountingCurrencySummaries, accountingDocumentHref, accountingListMoney, accountingListStatus, accountingSummaryValue, matchesAccountingListFilters } from "./accounting-list-display"

const now = new Date("2026-10-16T15:00:00Z")
const row = (overrides: Record<string, unknown> = {}): AccountMove & { currencyId?: unknown } => ({ id: 1n, state: { tag: "Posted" }, paymentState: { tag: "NotPaid" }, amountTotal: 100, amountResidual: 50, currencyId: 7n, ...overrides })
const options = [{ value: "7", label: "Euro", code: "EUR" }, { value: "8", label: "US Dollar", code: "USD" }]

describe("accounting list canonical filters", () => {
  it("matches exact record IDs and combines enum filters instead of substring matching", () => {
    expect(matchesAccountingListFilters(row(), { id: "1", state: "Posted" }, "invoice", now)).toBe(true)
    expect(matchesAccountingListFilters(row({ id: 10n }), { id: "1" }, "invoice", now)).toBe(false)
    expect(matchesAccountingListFilters(row({ state: "Draft" }), { id: "1", state: "Posted" }, "invoice", now)).toBe(false)
    expect(matchesAccountingListFilters(row({ paymentState: { tag: "Partial" } }), { payment_state: "Partial" }, "invoice", now)).toBe(true)
  })
  it("opens only posted documents with outstanding residual for AR/AP drill-downs", () => {
    expect(matchesAccountingListFilters(row(), { queue: "open" }, "invoice", now)).toBe(true)
    expect(matchesAccountingListFilters(row({ state: "Draft" }), { queue: "open" }, "invoice", now)).toBe(false)
    expect(matchesAccountingListFilters(row({ amountResidual: 0 }), { queue: "open" }, "bill", now)).toBe(false)
    expect(matchesAccountingListFilters(row({ state: "Cancelled" }), { queue: "open" }, "bill", now)).toBe(false)
  })
  it("uses calendar due dates consistently so an invoice due today is not overdue", () => {
    const today = row({ invoiceDateDue: { microsSinceUnixEpoch: BigInt(Date.parse("2026-10-16T00:00:00Z")) * 1000n } })
    const yesterday = row({ invoiceDateDue: { microsSinceUnixEpoch: BigInt(Date.parse("2026-10-15T00:00:00Z")) * 1000n } })
    expect(matchesAccountingListFilters(today, { queue: "overdue" }, "invoice", now)).toBe(false)
    expect(matchesAccountingListFilters(yesterday, { queue: "overdue" }, "invoice", now)).toBe(true)
  })
  it("normalizes tagged invoice and bill status without losing partial payments", () => {
    expect(accountingListStatus(row({ state: { tag: "Draft" } }), "invoice", now)).toBe("draft")
    expect(accountingListStatus(row({ paymentState: { tag: "Partial" } }), "bill", now)).toBe("partial")
    expect(accountingListStatus(row({ state: { cancelled: [] } }), "invoice", now)).toBe("cancelled")
  })
})

describe("accounting list money", () => {
  it("keeps currency totals separate and formats each row with its actual currency", () => {
    const groups = accountingCurrencySummaries([row(), row({ id: 2n, amountTotal: 30, currencyId: 8n }), row({ id: 3n, amountTotal: 40 })], options)
    expect(groups.map((group) => [group.currency.code, group.total])).toEqual([["EUR", 140], ["USD", 30]])
    expect(accountingSummaryValue(groups, "total")).toBe("2 currencies")
    expect(accountingListMoney(100, row(), options)).toContain("EUR")
    expect(accountingListMoney(100, row({ currencyId: 8n }), options)).toContain("USD")
  })
  it("never guesses a tenant currency ID or combines records with missing currency IDs", () => {
    expect(accountingListMoney(100, row(), [])).toContain("Currency #7")
    const groups = accountingCurrencySummaries([row({ currencyId: undefined }), row({ id: 2n, currencyId: undefined })], options)
    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.total === 100)).toBe(true)
  })
  it("keeps missing monetary fields unavailable rather than displaying zero", () => {
    const incomplete = row({ amountTotal: undefined })
    expect(accountingListMoney(undefined, incomplete, options)).toBe("—")
    expect(accountingSummaryValue(accountingCurrencySummaries([row(), incomplete], options), "total")).toBe("—")
  })
  it("links invoice and bill identifiers to their canonical document route", () => {
    expect(accountingDocumentHref(row({ id: 980n }))).toBe("/accounting/invoices/980")
  })
})
