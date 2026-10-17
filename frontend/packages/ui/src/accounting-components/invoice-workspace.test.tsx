import { createContext, useContext, type ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CreateInvoiceModal } from "./create-invoice-modal"
import { InvoiceDetailModal } from "./invoice-detail-modal"
import { formatInvoiceMoney, InvoiceDocument } from "./invoice-document"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("../forms/hooks/use-form-config", () => ({ useFormConfiguration: () => ({ config: { fields: [] } }) }))

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

describe("invoice workspace", () => {
  it("keeps an uncertain submission locked across close/reopen and checks the identical request", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "outcome-unknown", reason: "readback-missing" })
    const ref = { resource: "account_move", id: "99" }
    const onCheckStatus = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ref)
    const onResolved = vi.fn()
    const onClose = vi.fn()
    const props = { ...options, onSave, onCheckStatus, onResolved, onClose }
    const { rerender } = render(<CreateInvoiceModal {...props} open />)
    fillInvoice()
    fireEvent.click(screen.getByTestId("create-invoice-save-draft"))
    await screen.findByText("Check previous action")
    const request = onSave.mock.calls[0]![0]
    expect(request.currencyId).toBe(7n)
    expect(request.lines[0].name).toBe("Alpha services")
    expect((screen.getByTestId("create-invoice-line-description").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true)
    fireEvent.click(screen.getByText("Close and keep draft"))
    rerender(<CreateInvoiceModal {...props} open={false} />)
    rerender(<CreateInvoiceModal {...props} open />)
    expect((screen.getByTestId("create-invoice-line-description") as HTMLInputElement).value).toBe("Alpha services")
    expect(screen.queryByTestId("create-invoice-save-draft")).toBeNull()
    fireEvent.click(screen.getByText("Check previous action"))
    await screen.findByText("The invoice is still unconfirmed. Keep this form and check again later.")
    fireEvent.click(screen.getByText("Check previous action"))
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(ref))
    expect(onCheckStatus.mock.calls.every(([params]) => params === request)).toBe(true)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("switches the compact editor to preview without losing invoice entries", () => {
    render(<CreateInvoiceModal {...options} open onClose={vi.fn()} onSave={vi.fn()} onCheckStatus={vi.fn()} />)
    fillInvoice()
    fireEvent.click(screen.getByTestId("create-invoice-preview-toggle"))
    expect(screen.getByTestId("create-invoice-preview-toggle").getAttribute("aria-pressed")).toBe("true")
    expect(within(screen.getByRole("article", { name: "Document preview" })).getByText("Alpha services")).toBeTruthy()
    fireEvent.click(screen.getByText("Edit details"))
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
