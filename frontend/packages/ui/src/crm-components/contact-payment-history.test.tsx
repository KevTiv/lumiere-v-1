import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CurrencyFormatProvider } from "../lib/currency-context"

const sources = vi.hoisted(() => {
  const query = () => ({ data: [] as unknown[], isLoading: false, isError: false, error: undefined as unknown, refetch: vi.fn() })
  return { payments: query(), allocations: query(), fees: query(), messages: query(), batches: query() }
})
vi.mock("@lumiere/query-hooks/hooks/accounting", () => ({
  usePaymentTransactions: () => sources.payments,
  usePaymentReconciliations: () => sources.allocations,
  usePaymentFees: () => sources.fees,
}))
vi.mock("@lumiere/query-hooks/hooks/messages", () => ({
  useOperationalMessages: () => sources.messages,
  useMessageBatches: () => sources.batches,
}))
vi.mock("@lumiere/i18n", async () => {
  const { createInstance } = await import("i18next")
  const { default: en } = await import("../../../i18n/src/locales/en.json")
  const i18n = createInstance()
  await i18n.init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  return { useTranslation: () => ({ t: i18n.t, i18n }) }
})
import { ContactPaymentsAndMessagesPanel } from "../../../../web/app/(modules)/crm/contact-payments-and-messages-panel"

const payment = { id: "1", partnerId: "8", settlementAmount: 25, currencyId: "1", externalReference: "Provider reference", status: "Posted" }
const currencies = [{ id: "1", code: "USD" }, { id: "2", code: "EUR" }]
const view = () => render(<CurrencyFormatProvider currencies={currencies} locale="en"><ContactPaymentsAndMessagesPanel organizationId={7} contactId={8n} /></CurrencyFormatProvider>)

beforeEach(() => {
  for (const source of Object.values(sources)) {
    source.data = []; source.isLoading = false; source.isError = false; source.error = undefined; source.refetch.mockClear()
  }
})
afterEach(cleanup)

describe("contact payment and message history", () => {
  it("shows loading without an empty-history claim or cached payment", () => {
    sources.payments.isLoading = true
    sources.payments.data = [payment]
    view()
    const card = within(screen.getByTestId("contact-payment-history"))
    expect(card.getByRole("status")).toBeTruthy()
    expect(card.queryByText("No payment activity")).toBeNull()
    expect(card.queryByText("Provider reference")).toBeNull()
    expect(screen.getByText("No messages")).toBeTruthy()
  })

  it.each(["payments", "allocations", "fees"] as const)("hides cached payment data when %s are denied", (name) => {
    sources.payments.data = [payment]
    sources[name].isError = true
    sources[name].error = { status: 403 }
    view()
    const card = within(screen.getByTestId("contact-payment-history"))
    expect(card.getByRole("status").textContent).toContain("access")
    expect(card.queryByText("No payment activity")).toBeNull()
    expect(card.queryByText("Provider reference")).toBeNull()
    expect(card.queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("offers retry for a failed join and keeps independent message history available", () => {
    sources.payments.data = [payment]
    sources.fees.isError = true; sources.fees.error = { status: 500 }
    sources.messages.data = [{ id: "2", contactId: "8", renderedSubject: "Invoice reminder", messageBatchId: "3", status: "Queued" }]
    sources.batches.data = [{ id: "3", status: "Approved" }]
    view()
    const card = within(screen.getByTestId("contact-payment-history"))
    expect(card.getByRole("alert")).toBeTruthy()
    expect(card.queryByText("No payment activity")).toBeNull()
    fireEvent.click(card.getByRole("button", { name: "Retry" }))
    expect(sources.fees.refetch).toHaveBeenCalledOnce()
    expect(screen.getByText("Invoice reminder")).toBeTruthy()
  })

  it("does not claim no messages when batch approval cannot be read", () => {
    sources.batches.isError = true; sources.batches.error = { status: 500 }
    view()
    const card = within(screen.getByTestId("contact-message-history"))
    expect(card.getByRole("alert")).toBeTruthy()
    expect(card.queryByText("No messages")).toBeNull()
    expect(screen.getByText("No payment activity")).toBeTruthy()
  })

  it("shows confirmed empty histories only after all required reads finish", () => {
    view()
    expect(screen.getByText("No payment activity")).toBeTruthy()
    expect(screen.getByText("No messages")).toBeTruthy()
  })

  it("shows each row currency and separates mixed-currency allocation and fee totals", () => {
    sources.payments.data = [payment, { ...payment, id: "other", partnerId: "9", externalReference: "Other contact" }]
    sources.allocations.data = [
      { paymentTransactionId: "1", currencyId: "1", allocatedAmount: 10 },
      { paymentTransactionId: "1", currencyId: "2", allocatedAmount: 20 },
    ]
    sources.fees.data = [
      { paymentTransactionId: "1", currencyId: "1", amount: 1, taxAmount: 0.2 },
      { paymentTransactionId: "1", currencyId: "2", amount: 2, taxAmount: 0.5 },
    ]
    view()
    const text = screen.getByTestId("contact-payment-history").textContent!
    for (const value of ["$25.00 (USD)", "$10.00 (USD)", "€20.00 (EUR)", "$1.20 (USD)", "€2.50 (EUR)"]) expect(text).toContain(value)
    expect(text).not.toContain("$30.00")
    expect(screen.queryByText("Other contact")).toBeNull()
  })

  it.each([null, "", "  ", "invalid", true, Infinity])("does not render an unavailable amount (%s) as zero", (settlementAmount) => {
    sources.payments.data = [{ ...payment, settlementAmount }]
    view()
    const text = screen.getByTestId("contact-payment-history").textContent!
    expect(text).toContain("Amount or currency unavailable")
    expect(text).not.toContain("$0.00")
  })

  it("preserves a real zero and does not guess the currency for an unknown currency ID", () => {
    sources.payments.data = [{ ...payment, settlementAmount: 0 }, { ...payment, id: "2", currencyId: "missing" }]
    view()
    const text = screen.getByTestId("contact-payment-history").textContent!
    expect(text).toContain("$0.00 (USD)")
    expect(text).toContain("Amount or currency unavailable")
    expect(text).not.toContain("$25.00")
  })
})
