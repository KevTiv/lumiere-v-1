import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "@lumiere/i18n"
import { resolveInvoiceProfile } from "@lumiere/erp-shared/invoice-personalization"
import type { AccountMove } from "../lib/accounting-types"
import { accountingCurrencySummaries, accountingSummaryValue } from "./accounting-list-display"
import { CollectionsWorkspace } from "./collections-workspace"
import { InvoiceComposer } from "./invoice-composer"
import { InvoiceDocument } from "./invoice-document"
import { InvoiceEmailReviewDialog } from "./invoice-email-review-dialog"
import { invoiceEmailDocumentKey, invoiceEmailRecipientProblem, invoiceEmailScope, type InvoiceEmailSubmission } from "./invoice-email-review"

vi.mock("../forms/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: () => null }))

const originalFrench = structuredClone(i18n.getResourceBundle("fr", "translation"))
beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent)
  i18n.addResourceBundle("fr", "translation", {
    accounting: {
      invoiceComposer: { invoicePane: "Volets de facture" },
      invoiceDocument: { draftDocument: "Brouillon de document" },
      accountingListDisplay: {
        currencyValue: "Devise n° {{id}}",
        currencyCount_one: "{{count}} devise",
        currencyCount_other: "{{count}} devises",
      },
      invoiceEmailReview: { enterOneValidRecipientEmailAddress: "Saisissez une adresse valide." },
      collectionsWorkspace: {
        overdueCount_one: "{{count}} facture en retard. Soldes par devise.",
        overdueCount_other: "{{count}} factures en retard. Soldes par devise.",
        invoiceAging_one: "Échéance {{dueDate}} · {{count}} jour de retard · {{balance}} restant",
        invoiceAging_other: "Échéance {{dueDate}} · {{count}} jours de retard · {{balance}} restant",
      },
      invoiceEmailReviewDialog: {
        reviewPaymentReminder: "Vérifier le rappel",
        helloValueThisIsAReminderThatPaymentForInvoice: "Bonjour {{value1}}, rappel pour {{value2}}. {{value3}}",
      },
    },
  }, true, true)
})
beforeEach(async () => { await i18n.changeLanguage("en") })
afterEach(async () => { cleanup(); await i18n.changeLanguage("en") })
afterAll(() => {
  vi.unstubAllGlobals()
  i18n.removeResourceBundle("fr", "translation")
  i18n.addResourceBundle("fr", "translation", originalFrench)
})

const invoice = (id: number): AccountMove => ({
  id, organizationId: 1, companyId: 2, name: `INV/${id}`, state: "Posted", moveType: "OutInvoice",
  invoicePartnerDisplayName: "Customer supplied name", amountResidual: 12, amountTotal: 12,
  currencyId: 7, invoiceDateDue: { microsSinceUnixEpoch: BigInt(Date.parse("2026-10-28T00:00:00Z")) * 1000n },
})

describe("Finance translation coverage", () => {
  it("updates visible and accessible preview labels while preserving document content", async () => {
    render(<>
      <InvoiceComposer form={<input aria-label="User content" defaultValue="Typed invoice text" />} preview={{ kind: "invoice", lines: [], totals: { subtotal: 0, tax: 0, total: 0, taxBreakdown: [] } }} />
      <InvoiceDocument title="INV/7" partnerLabel="Customer" subtotal={12} tax={0} total={12} draft personalization={{
        schemaVersion: 1, profileVersionIds: { organization: null, company: null },
        seller: { name: "Company supplied name", address: [], taxId: "", registrationNumber: "", email: "", phone: "", website: "" },
        profile: resolveInvoiceProfile({ terms: "Contract terms supplied by the company" }), notes: "Customer supplied notes",
      }} />
    </>)
    expect(screen.getByRole("tablist", { name: "Invoice pane" })).toBeTruthy()
    await act(async () => { await i18n.changeLanguage("fr") })
    expect(screen.getByRole("tablist", { name: "Volets de facture" })).toBeTruthy()
    expect(screen.getByText("Brouillon de document")).toBeTruthy()
    expect(screen.getByText("Contract terms supplied by the company")).toBeTruthy()
    expect(screen.getByText("Customer supplied notes")).toBeTruthy()
    expect((screen.getByLabelText("User content") as HTMLInputElement).value).toBe("Typed invoice text")
  })

  it("resolves runtime helper labels and validation in the current language", async () => {
    expect(invoiceEmailRecipientProblem("invalid")).toBe("Enter one valid recipient email address.")
    await i18n.changeLanguage("fr")
    expect(invoiceEmailRecipientProblem("invalid")).toBe("Saisissez une adresse valide.")
    const groups = accountingCurrencySummaries([invoice(1), { ...invoice(2), currencyId: 8 }], [])
    expect(groups[0]?.label).toBe("Devise n° 7")
    expect(accountingSummaryValue(groups, "total")).toBe("2 devises")
  })

  it("uses complete plural messages for collection counts and overdue days", async () => {
    const props = { scope: { organizationId: 1, companyId: 2 }, dataState: { status: "ready" as const }, canReview: true, onReviewReminder: vi.fn(), now: new Date("2026-10-29T12:00:00Z") }
    const { rerender } = render(<CollectionsWorkspace {...props} invoices={[invoice(1), invoice(2)]} />)
    await act(async () => { await i18n.changeLanguage("fr") })
    expect(screen.getByText("2 factures en retard. Soldes par devise.")).toBeTruthy()
    expect(screen.getAllByText(/1 jour de retard/)).toHaveLength(2)
    rerender(<CollectionsWorkspace {...props} invoices={[invoice(1)]} />)
    expect(screen.getByText("1 facture en retard. Soldes par devise.")).toBeTruthy()
  })

  it("keeps the exact reviewed reminder after a language change", async () => {
    const document = { organizationId: 1n, companyId: 2n, moveId: 7n, reference: "INV/7", partner: "Alpha", companyName: "Our company", totalLabel: "EUR 12.00", pdfFilename: "invoice.pdf", posted: true, revision: "v1" }
    const onQueue = vi.fn(async (submission: InvoiceEmailSubmission) => ({ status: "queued" as const, submission, messageId: 9n }))
    render(<InvoiceEmailReviewDialog open purpose="reminder" document={document} currentScopeKey={invoiceEmailScope(document)} currentDocumentKey={invoiceEmailDocumentKey(document)} templates={[{ id: 1n, organizationId: 1n, name: "User template name", model: "account_move", subject: "Stored subject", bodyHtml: "Stored message", attachDocument: false, isDefault: true, isActive: true }]} templateState={{ status: "ready" }} canQueue canCheck onQueue={onQueue} onCheck={vi.fn()} onReviewPdf={vi.fn()} onReloadTemplates={vi.fn()} onClose={vi.fn()} />)
    const original = (screen.getByTestId("invoice-email-body") as HTMLTextAreaElement).value
    fireEvent.change(screen.getByTestId("invoice-email-recipient"), { target: { value: "alpha@example.test" } })
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this recipient/ }))
    fireEvent.click(screen.getByTestId("invoice-email-queue"))
    await screen.findByText("Email queue confirmed")
    await act(async () => { await i18n.changeLanguage("fr") })
    expect(screen.getByText("Vérifier le rappel")).toBeTruthy()
    expect(screen.getByTestId("invoice-email-body").textContent).toBe(original)
    expect(onQueue.mock.calls[0]?.[0].content?.bodyText).toBe(original)
    expect(onQueue).toHaveBeenCalledTimes(1)
  })
})
