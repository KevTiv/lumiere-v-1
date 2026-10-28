import { createContext, useContext, type ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CreateInvoiceModal } from "./create-invoice-modal"
import { InvoiceDetailModal } from "./invoice-detail-modal"
import { formatInvoiceMoney, InvoiceDocument, readInvoiceDocumentContent, resolveDraftInvoiceDocument } from "./invoice-document"
import { resolveInvoiceProfile, type InvoiceDocumentSnapshot } from "@lumiere/erp-shared/invoice-personalization"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
const configuredFields = vi.hoisted(() => ({ fields: [] as { fieldId: string; label: string; isEnabled: boolean; validation: { required: boolean } }[] }))
vi.mock("../forms/hooks/use-form-config", () => ({ useFormConfiguration: () => ({ config: configuredFields }) }))

// Exercise the invoice workflow with deterministic native selection; the browser
// fixture covers the real Radix controls and responsive layout.
const Selection = createContext({ value: "", onValueChange: (_value: string) => {} })
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <Selection.Provider value={{ value, onValueChange }}>{children}</Selection.Provider>,
  SelectTrigger: ({ id, children: _children, ...props }: { id: string; children?: ReactNode }) => {
    const selection = useContext(Selection)
    return <input {...props} id={id} value={selection.value} onChange={(event) => selection.onValueChange(event.target.value)} />
  },
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}))

afterEach(cleanup)
beforeEach(() => { configuredFields.fields = [] })

const options = {
  companyId: 1n,
  journalOptions: [{ value: "10", label: "Sales journal", currencyId: "7" }],
  partnerOptions: [{ value: "20", label: "Alpha customer" }],
  counterpartAccountOptions: [{ value: "30", label: "Receivable" }],
  lineAccountOptions: [{ value: "40", label: "Sales" }],
  currencyOptions: [{ value: "7", label: "Euro", code: "EUR" }],
}

function fillInvoice() {
  fireEvent.change(screen.getByTestId("create-invoice-partner"), { target: { value: "20" } })
  fireEvent.change(screen.getByTestId("create-invoice-line-description"), { target: { value: "Alpha services" } })
  fireEvent.change(screen.getByTestId("create-invoice-line-unit-price"), { target: { value: "120" } })
}

const profile = resolveInvoiceProfile({ notice: "Company notice", terms: "Net 30", paymentInstructions: "Pay by bank transfer", footer: "Registered office", email: "accounts@example.test", accent: "violet" })
const seller = { name: "Alpha Legal Company", address: ["123 Main Street", "Paris", "75001", "FR"], taxId: "FR123", registrationNumber: "REG42", email: profile.email, phone: "", website: "" }
const snapshot: InvoiceDocumentSnapshot = { schemaVersion: 1, profileVersionIds: { organization: "1", company: "2" }, seller, profile, notes: "Saved invoice notes" }

describe("invoice workspace", () => {
  it("keeps required custom fields enforced and contains a long rejected-save error without losing entries", async () => {
    configuredFields.fields = [{ fieldId: "custom:approval_reference", label: "Approval reference", isEnabled: true, validation: { required: true } }]
    const rejection = "Review the selected account.\n" + "LongServerExplanation".repeat(400)
    const onSave = vi.fn().mockResolvedValue({ kind: "rejected", error: { message: rejection } })
    render(<CreateInvoiceModal {...options} open onClose={vi.fn()} onSave={onSave} onCheckStatus={vi.fn()} />)
    fillInvoice()
    const editor = screen.getByTestId("finance-review-editor")
    const body = screen.getByTestId("create-invoice-scroll-body")
    const dialog = screen.getByTestId("create-invoice-modal")
    body.scrollTop = 600
    dialog.scrollTop = 250
    expect((screen.getByTestId("create-invoice-save-draft") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId("create-invoice-custom-custom:approval_reference"), { target: { value: "APPROVAL-42" } })
    expect((screen.getByTestId("create-invoice-save-draft") as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    await screen.findByRole("alert")
    expect(screen.getByRole("alert").textContent).toBe(rejection)
    expect(body.contains(screen.getByRole("alert"))).toBe(true)
    expect(body.scrollTop).toBe(0)
    expect(dialog.scrollTop).toBe(250)
    expect(screen.getByTestId("finance-review-editor")).toBe(editor)
    expect(body.contains(screen.getByTestId("create-invoice-save-draft"))).toBe(false)
    body.scrollTop = 180
    fireEvent.change(screen.getByTestId("create-invoice-line-description"), { target: { value: "Alpha services, corrected" } })
    expect(body.scrollTop).toBe(180)
    expect((screen.getByTestId("create-invoice-line-description") as HTMLInputElement).value).toBe("Alpha services, corrected")
    expect((screen.getByTestId("create-invoice-custom-custom:approval_reference") as HTMLInputElement).value).toBe("APPROVAL-42")
    expect(JSON.parse(onSave.mock.calls[0]![0].metadata)["custom:approval_reference"]).toBe("APPROVAL-42")
  })

  it.each(["invoice", "bill"] as const)("puts %s business entry before visible accounting choices", (kind) => {
    render(<CreateInvoiceModal {...options} kind={kind} open onClose={vi.fn()} onSave={vi.fn()} onCheckStatus={vi.fn()} />)
    const editor = screen.getByTestId("finance-review-editor")
    const details = within(editor).getByRole("region", { name: "Document details" })
    const payment = within(editor).getByRole("region", { name: "Payment details" })
    const accounting = within(editor).getByRole("region", { name: "Accounting details" })
    expect(details.compareDocumentPosition(screen.getByTestId("create-invoice-line-description")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId("create-invoice-line-description").compareDocumentPosition(payment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(payment.compareDocumentPosition(accounting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(accounting).getByLabelText(`accounting.forms.${kind === "bill" ? "newBill" : "newInvoice"}.fields.journal`)).toBeTruthy()
    expect(within(accounting).getByLabelText(kind === "bill" ? "Payable account" : "Receivable account")).toBeTruthy()
    expect(within(accounting).getByText(/Review the journal and accounts before saving/)).toBeTruthy()
    expect((within(details).getByLabelText("Currency") as HTMLInputElement).value).toBe("Euro")
  })

  it("summarizes inherited content, retains edits while collapsed, and restores inheritance explicitly", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "outcome-unknown" })
    render(<CreateInvoiceModal {...options} open onClose={vi.fn()} onSave={onSave} onCheckStatus={vi.fn()} profile={profile} />)
    const toggle = screen.getByTestId("create-invoice-content-toggle")
    const summary = screen.getByTestId("create-invoice-content-summary")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("textbox", { name: "Terms" })).toBeNull()
    expect(summary.textContent).toContain("Company default")
    expect(summary.textContent).toContain("Net 30")
    fireEvent.click(toggle)
    fireEvent.change(screen.getByRole("textbox", { name: "Terms" }), { target: { value: "Special terms" } })
    fireEvent.click(screen.getByText("Use company default"))
    expect((screen.getByRole("textbox", { name: "Terms" }) as HTMLTextAreaElement).value).toBe("Net 30")
    fireEvent.change(screen.getByRole("textbox", { name: "Terms" }), { target: { value: "" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), { target: { value: "Invoice-only notice" } })
    fireEvent.click(toggle)
    expect(summary.textContent).toContain("Cleared for this document")
    expect(summary.textContent).toContain("Edited for this document")
    expect(summary.textContent).toContain("Invoice-only notice")
    expect(screen.queryByRole("textbox", { name: "Terms" })).toBeNull()
    fireEvent.click(toggle)
    expect((screen.getByRole("textbox", { name: "Terms" }) as HTMLTextAreaElement).value).toBe("")
    expect((screen.getByRole("textbox", { name: "Notice" }) as HTMLTextAreaElement).value).toBe("Invoice-only notice")
    fireEvent.click(toggle)
    fillInvoice()
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(onSave.mock.calls[0]![0]).toMatchObject({ companyId: 1n, journalId: 10n, partnerId: 20n, counterpartAccountId: 30n, currencyId: 7n,
      lines: [{ accountId: 40n, name: "Alpha services", quantity: 1, priceUnit: 120, discount: 0, taxIds: [] }] })
    expect(JSON.parse(onSave.mock.calls[0]![0].metadata)).toEqual({ notes: "", invoiceContent: { schemaVersion: 1, terms: "", notice: "Invoice-only notice" } })
  })

  it.each(["invoice", "bill"] as const)("mounts the %s review workspace and preserves real draft fields across views", (kind) => {
    const onSave = vi.fn()
    render(<CreateInvoiceModal {...options} kind={kind} open onClose={vi.fn()} onSave={onSave} onCheckStatus={vi.fn()} />)
    const review = screen.getByTestId("finance-review-workspace")
    const editor = within(review).getByTestId("finance-review-editor")
    const preview = within(review).getByTestId("finance-review-document")
    expect(editor.hidden).toBe(false)
    expect(preview.hidden).toBe(false)
    fillInvoice()
    const description = screen.getByTestId("create-invoice-line-description") as HTMLInputElement
    for (const name of ["Document preview", "Edit document", "Side by side"]) {
      fireEvent.click(within(review).getByRole("tab", { name }))
      expect(document.querySelector('[data-testid="create-invoice-line-description"]')).toBe(description)
      expect(description.value).toBe("Alpha services")
      expect((within(review).getByTestId("create-invoice-line-unit-price") as HTMLInputElement).value).toBe("120")
    }
    expect(within(review).getAllByTestId("create-invoice-line-description")).toHaveLength(1)
    expect(review.contains(screen.getByTestId("create-invoice-save-draft"))).toBe(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("prefills defaults, stores explicit clears separately from notes, and leaves snapshots server-owned", async () => {
    configuredFields.fields = [{ fieldId: "custom:purchase_reference", label: "Purchase reference", isEnabled: true, validation: { required: false } }]
    const onSave = vi.fn().mockResolvedValue({ kind: "outcome-unknown" })
    render(<CreateInvoiceModal {...options} open onClose={vi.fn()} onSave={onSave} onCheckStatus={vi.fn()} profile={profile} seller={seller} profileVersionIds={snapshot.profileVersionIds} personalizationState={{ status: "ready" }} />)
    fireEvent.click(screen.getByTestId("create-invoice-content-toggle"))
    expect((screen.getByRole("textbox", { name: "Terms" }) as HTMLTextAreaElement).value).toBe("Net 30")
    fillInvoice()
    fireEvent.change(screen.getByTestId("create-invoice-custom-custom:purchase_reference"), { target: { value: "PO-42" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Terms" }), { target: { value: "" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), { target: { value: "This invoice only" } })
    fireEvent.change(screen.getByLabelText("accounting.forms.newInvoice.notesOptional"), { target: { value: "Separate notes" } })
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(JSON.parse(onSave.mock.calls[0]![0].metadata)).toEqual({ "custom:purchase_reference": "PO-42", notes: "Separate notes", invoiceContent: { schemaVersion: 1, terms: "", notice: "This invoice only" } })
  })

  it("keeps dirty edits through close, company changes and refreshed defaults until explicitly reviewed", () => {
    const props = { ...options, onClose: vi.fn(), onSave: vi.fn(), onCheckStatus: vi.fn(), profile, seller, personalizationState: { status: "ready" as const } }
    const { rerender } = render(<CreateInvoiceModal {...props} open />)
    fireEvent.click(screen.getByTestId("create-invoice-content-toggle"))
    fillInvoice()
    fireEvent.change(screen.getByRole("textbox", { name: "Notice" }), { target: { value: "Private edit" } })
    fireEvent.click(screen.getByText("common.cancel"))
    rerender(<CreateInvoiceModal {...props} open={false} />)
    rerender(<CreateInvoiceModal {...props} open companyId={2n} profile={{ ...profile, terms: "Company B terms" }} />)
    expect(screen.getByText(/This draft belongs to company #1/)).toBeTruthy()
    expect(screen.getByTestId("create-invoice-content-summary").textContent).toContain("Private edit")
    expect((screen.getByTestId("create-invoice-save-draft") as HTMLButtonElement).disabled).toBe(true)
    rerender(<CreateInvoiceModal {...props} open profile={{ ...profile, terms: "Current company A terms" }} />)
    fireEvent.click(screen.getByTestId("create-invoice-content-toggle"))
    expect((screen.getByRole("textbox", { name: "Terms" }) as HTMLTextAreaElement).value).toBe("Net 30")
    expect((screen.getByTestId("create-invoice-save-draft") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText("Apply current invoice defaults"))
    expect((screen.getByRole("textbox", { name: "Terms" }) as HTMLTextAreaElement).value).toBe("Current company A terms")
    expect((screen.getByRole("textbox", { name: "Notice" }) as HTMLTextAreaElement).value).toBe("Private edit")
    expect((screen.getByTestId("create-invoice-save-draft") as HTMLButtonElement).disabled).toBe(false)
  })

  it("does not apply customer branding or invoice overrides to vendor bills", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "outcome-unknown" })
    render(<CreateInvoiceModal {...options} kind="bill" open onClose={vi.fn()} onSave={onSave} onCheckStatus={vi.fn()} profile={profile} seller={seller} personalizationState={{ status: "loading" }} />)
    expect(screen.queryByLabelText("Terms")).toBeNull()
    expect(screen.queryByText(seller.name)).toBeNull()
    fillInvoice()
    fireEvent.change(screen.getByLabelText("accounting.forms.newInvoice.notesOptional"), { target: { value: "Vendor review note" } })
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    expect(JSON.parse(onSave.mock.calls[0]![0].metadata)).toEqual({ notes: "Vendor review note" })
  })

  it("reads issued content only from its captured snapshot, with legacy top-level notes fallback", () => {
    const saved = readInvoiceDocumentContent(JSON.stringify({ invoiceDocument: snapshot, notes: "Not the captured notes", custom: { reference: "kept" } }), 1)
    expect(saved.personalization).toEqual(snapshot)
    expect(saved.notes).toBe("Saved invoice notes")
    expect(readInvoiceDocumentContent('{"notes":"Legacy notes"}')).toEqual({ personalization: null, notes: "Legacy notes", personalizationError: undefined })
    expect(readInvoiceDocumentContent("Historic sales order note")).toEqual({ personalization: null, notes: "Historic sales order note", personalizationError: undefined })
    expect(readInvoiceDocumentContent('{"invoiceDocument":').personalizationError).toBeTruthy()
    const changed = resolveDraftInvoiceDocument({ invoiceContent: { schemaVersion: 1, terms: "" }, notes: "Draft notes" }, { ...profile, notice: "New company notice" }, { organization: "3", company: "4" }, seller)
    expect(changed.personalization?.profile.notice).toBe("New company notice")
    expect(changed.personalization?.profile.terms).toBe("")
    expect(saved.personalization?.profile.notice).toBe("Company notice")
    expect(readInvoiceDocumentContent({ invoiceDocument: { ...snapshot, schemaVersion: 3 } }).personalizationError).toMatch(/unsupported/)
    expect(resolveDraftInvoiceDocument({ invoiceContent: { schemaVersion: 2 } }, profile, snapshot.profileVersionIds, seller).personalizationError).toMatch(/unsupported/)
  })

  it("renders complete captured identity and labelled plaintext content on independent light paper", () => {
    render(<InvoiceDocument title="Invoice" partnerLabel="Bill to" personalization={{ ...snapshot, profile: { ...profile, notice: "<b>Not HTML</b>", logoUrl: "https://unmanaged.example.test/logo.png" } }} subtotal={10} tax={0} total={10} />)
    const paper = screen.getByTestId("invoice-document")
    expect(paper.style.backgroundColor).toBe("rgb(255, 255, 255)")
    expect(paper.style.colorScheme).toBe("light")
    expect(screen.getByLabelText("Seller details").textContent).toContain("Registration number: REG42")
    expect(screen.getByLabelText("Seller details").textContent).toContain("Email: accounts@example.test")
    expect(screen.getByLabelText("Notice").textContent).toContain("<b>Not HTML</b>")
    expect(paper.querySelector("b")).toBeNull()
    expect(paper.querySelector("img")).toBeNull()
    for (const section of ["Notes", "Terms", "Payment instructions", "Footer"]) expect(screen.getByLabelText(section)).toBeTruthy()
  })

  it("renders captured V2 customer details without substituting a current partner name", () => {
    const buyer = { partnerId: "20", name: "Captured customer", address: ["10 Historic Road", "Kigali"], taxId: "TIN20", registrationNumber: "REG20", email: "buyer@example.test", phone: "+250 000 000" }
    render(<InvoiceDocument title="Invoice" partnerLabel="Bill to" partner="Today's renamed contact" personalization={{ ...snapshot, schemaVersion: 2, buyer }} subtotal={10} tax={0} total={10} />)
    expect(screen.getByText("Captured customer")).toBeTruthy()
    const details = screen.getByLabelText("Captured customer billing details")
    expect(details.textContent).toContain("10 Historic Road")
    expect(details.textContent).toContain("TIN20")
    expect(screen.queryByText("Today's renamed contact")).toBeNull()
  })

  it("preserves captured draft buyer while refreshing seller defaults, and rejects malformed snapshots", () => {
    const buyer = { partnerId: "20", name: "Captured customer", address: ["Historic address"], taxId: "TIN20", registrationNumber: "", email: "", phone: "" }
    const metadata = { invoiceDocument: { ...snapshot, schemaVersion: 2, buyer } }
    const reviewed = resolveDraftInvoiceDocument(metadata, { ...profile, notice: "Current company notice" }, snapshot.profileVersionIds, seller)
    expect(reviewed.personalization?.schemaVersion).toBe(2)
    expect(reviewed.personalization?.schemaVersion === 2 ? reviewed.personalization.buyer : null).toEqual(buyer)
    expect(reviewed.personalization?.profile.notice).toBe("Current company notice")
    expect(resolveDraftInvoiceDocument({ invoiceDocument: { ...snapshot, schemaVersion: 2 } }, profile, snapshot.profileVersionIds, seller).personalizationError).toBeTruthy()
  })

  it("labels legacy issued billing details unavailable instead of inventing an address", () => {
    render(<InvoiceDocument title="Invoice" partnerLabel="Bill to" partner="Legacy customer" personalization={snapshot} subtotal={10} tax={0} total={10} />)
    expect(screen.queryByLabelText("Captured customer billing details")).toBeNull()
    expect(screen.getByText("Customer billing details were not captured on this document.")).toBeTruthy()
  })

  it("blocks outgoing draft posting until the current profile is readable, while ignoring it on vendor bills", () => {
    const onPostDraft = vi.fn()
    const invoice = { id: 1n, name: "INV/001", state: { tag: "Draft" }, moveType: { tag: "OutInvoice" }, amountTotal: 120, amountResidual: 120, metadata: JSON.stringify({ invoiceDocument: snapshot }) }
    const { rerender } = render(<InvoiceDetailModal open onClose={vi.fn()} invoice={invoice} draftPersonalizationState={{ status: "loading" }} onPostDraft={onPostDraft} />)
    expect((screen.getByTestId("invoice-detail-post-draft") as HTMLButtonElement).disabled).toBe(true)
    rerender(<InvoiceDetailModal open onClose={vi.fn()} invoice={{ ...invoice, moveType: { tag: "InInvoice" } }} draftPersonalization={snapshot} draftPersonalizationState={{ status: "loading" }} onPostDraft={onPostDraft} />)
    expect(screen.queryByText(seller.name)).toBeNull()
    expect((screen.getByTestId("invoice-detail-post-draft") as HTMLButtonElement).disabled).toBe(false)
  })

  it("keeps an uncertain submission locked across close/reopen and checks the identical request", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "outcome-unknown", reason: "readback-missing" })
    const ref = { resource: "account_move", id: "99" }
    const onCheckStatus = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ref)
    const onResolved = vi.fn()
    const onClose = vi.fn()
    const props = { ...options, onSave, onCheckStatus, onResolved, onClose, profile, seller, profileVersionIds: snapshot.profileVersionIds }
    const { rerender } = render(<CreateInvoiceModal {...props} open />)
    fireEvent.click(screen.getByTestId("create-invoice-content-toggle"))
    fillInvoice()
    fireEvent.change(screen.getByRole("textbox", { name: "Terms" }), { target: { value: "Frozen explicit terms" } })
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    await screen.findByText("Check previous action")
    const request = onSave.mock.calls[0]![0]
    expect(request.currencyId).toBe(7n)
    expect(request.lines[0].name).toBe("Alpha services")
    expect((screen.getByTestId("create-invoice-line-description").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true)
    fireEvent.click(screen.getByText("Close and keep draft"))
    rerender(<CreateInvoiceModal {...props} open={false} />)
    rerender(<CreateInvoiceModal {...props} open companyId={2n} profile={{ ...profile, terms: "New company defaults" }} />)
    expect((screen.getByTestId("create-invoice-line-description") as HTMLInputElement).value).toBe("Alpha services")
    expect(screen.queryByTestId("create-invoice-save-draft")).toBeNull()
    fireEvent.click(screen.getByText("Check previous action"))
    await screen.findByText("The invoice is still unconfirmed. Keep this form and check again later.")
    fireEvent.click(screen.getByText("Check previous action"))
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(ref))
    expect(onCheckStatus.mock.calls.every(([params]) => params === request)).toBe(true)
    expect(request.companyId).toBe(1n)
    expect(JSON.parse(request.metadata).invoiceContent.terms).toBe("Frozen explicit terms")
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("switches the compact editor to preview without losing invoice entries", () => {
    render(<CreateInvoiceModal {...options} open onClose={vi.fn()} onSave={vi.fn()} onCheckStatus={vi.fn()} />)
    fillInvoice()
    fireEvent.click(screen.getByTestId("create-invoice-preview-toggle"))
    expect(screen.getByTestId("create-invoice-preview-toggle").getAttribute("aria-selected")).toBe("true")
    expect(within(screen.getByRole("article", { name: "Document preview" })).getByText("Alpha services")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Edit document" }))
    expect((screen.getByTestId("create-invoice-line-unit-price") as HTMLInputElement).value).toBe("120")
  })

  it("keeps an in-flight draft open until canonical save completes", async () => {
    const ref = { resource: "account_move", id: "101" }
    let finish!: (value: { kind: "converged"; ref: typeof ref; dispatch: "acknowledged" }) => void
    const onSave = vi.fn(() => new Promise<{ kind: "converged"; ref: typeof ref; dispatch: "acknowledged" }>((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    const onResolved = vi.fn()
    render(<CreateInvoiceModal {...options} open onClose={onClose} onResolved={onResolved} onSave={onSave} onCheckStatus={vi.fn()} />)
    fillInvoice()
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    expect((screen.getByText("common.cancel") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText("Close"))
    expect(onClose).not.toHaveBeenCalled()
    finish({ kind: "converged", ref, dispatch: "acknowledged" })
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(ref))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("uses currency metadata and canonical line amounts without assuming dollars", () => {
    expect(formatInvoiceMoney(12, { id: "7" })).toBe("12.00 · Currency #7")
    expect(formatInvoiceMoney(12, { code: "EUR" })).toContain("EUR")
    render(<InvoiceDocument title="Invoice" partnerLabel="Bill to" currency={{ code: "EUR" }} lines={[{ id: "1", description: "Rounded amount", quantity: 2, unitPrice: 5, discount: 0, amount: 9.99 }]} subtotal={9.99} tax={0} total={9.99} />)
    expect(within(screen.getByRole("row", { name: /Rounded amount/ })).getByText(/9.99/)).toBeTruthy()
    expect(screen.queryByText(/USD/)).toBeNull()
  })

  it("preserves unavailable canonical amounts without substituting calculated values or zero", () => {
    for (const amount of [null, undefined, NaN, Infinity]) expect(formatInvoiceMoney(amount, { code: "EUR" })).toBe("—")
    expect(formatInvoiceMoney(0, { code: "EUR" })).toContain("0.00")
    render(<InvoiceDocument title="Invoice" partnerLabel="Bill to" currency={{ code: "EUR" }}
      lines={[{ id: "1", description: "Redacted line", quantity: 2, unitPrice: 100, discount: 0, amount: null }]}
      subtotal={null} tax={null} total={null} />)
    expect(within(screen.getByRole("row", { name: /Redacted line/ })).getByText("—")).toBeTruthy()
    expect(screen.queryByText(/200.00|0.00/)).toBeNull()
  })

  it("exposes posting as the draft next action and only offers an actual PDF callback", () => {
    const onPostDraft = vi.fn()
    render(<InvoiceDetailModal open onClose={vi.fn()} invoice={{ id: 1n, name: "INV/001", state: { tag: "Draft" }, moveType: { tag: "OutInvoice" }, amountTotal: 120, amountResidual: 120 }} currencyCode="EUR" onPostDraft={onPostDraft} />)
    fireEvent.click(screen.getByTestId("invoice-detail-post-draft"))
    expect(onPostDraft).toHaveBeenCalledOnce()
    expect(screen.queryByText("accounting.invoices.invoiceActions.download")).toBeNull()
    expect(screen.queryByText("accounting.invoices.invoiceActions.print")).toBeNull()
  })

  it("keeps credit-note correction directly available for posted customer invoices", () => {
    const onCreateCreditNote = vi.fn()
    render(<InvoiceDetailModal open onClose={vi.fn()} invoice={{ id: 1n, name: "INV/001", state: { tag: "Posted" }, moveType: { tag: "OutInvoice" }, amountTotal: 120, amountResidual: 0 }} currencyCode="EUR" onCreateCreditNote={onCreateCreditNote} />)
    fireEvent.click(screen.getByTestId("invoice-detail-create-credit-note"))
    expect(onCreateCreditNote).toHaveBeenCalledOnce()
  })
})
