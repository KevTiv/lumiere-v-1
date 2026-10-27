import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AccountMove } from "../lib/accounting-types"

const permissions = vi.hoisted(() => ({ create: true }))
vi.mock("../lib/rbac-context", () => ({
  useRBAC: () => ({ checkPermission: () => ({ allowed: permissions.create }) }),
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
import { InvoiceListView } from "./invoice-list-view"
import { BillsListView } from "./bills-list-view"

afterEach(() => {
  cleanup()
  permissions.create = true
})
const rows: AccountMove[] = [
  {
    id: 1,
    organizationId: 1,
    companyId: 1,
    name: "INV-1",
    state: { tag: "Posted" },
    paymentState: "NotPaid",
    moveType: "OutInvoice",
    amountTotal: 100,
    amountResidual: 50,
    currencyId: 7,
  },
  {
    id: 10,
    organizationId: 1,
    companyId: 1,
    name: "INV-10",
    state: { tag: "Draft" },
    moveType: "OutInvoice",
    amountTotal: 30,
    amountResidual: 30,
    currencyId: 8,
  },
]
const scope = { organizationId: 1, companyId: 1 }
const currencies = [
  { value: "7", code: "EUR", label: "Euro" },
  { value: "8", code: "USD", label: "US Dollar" },
]

describe("accounting document lists", () => {
  it("keeps draft intake compact, scoped and reachable without losing a selected receipt", () => {
    const billRows = rows.map((row) => ({ ...row, moveType: "InInvoice" }))
    const otherCompanyBill = { ...billRows[1]!, id: 99, companyId: 2, name: "OTHER-COMPANY-BILL" }
    const onOpen = vi.fn()
    render(<BillsListView worklistScope={scope} bills={[...billRows, otherCompanyBill]} currencyOptions={currencies}
      onSelectBill={onOpen} intake={{ lines: [], sourceState: { status: "ready" }, renderDocuments: () => <input type="file" aria-label="Supplier receipt" /> }} />)
    const disclosure = screen.getByRole("button", { name: "Bill intake review" })
    expect(disclosure.getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByTestId("bill-intake-summary").textContent).toBe("Draft bills to review: 1")
    expect(screen.queryByRole("button", { name: "Review bill" })).toBeNull()
    expect(screen.getByTestId("entity-row-10")).toBeTruthy()
    fireEvent.click(disclosure)
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Review bill" }))
    expect(onOpen).toHaveBeenCalledWith(billRows[1])
    fireEvent.click(screen.getByRole("button", { name: "Supplier documents and receipts" }))
    const receipt = screen.getByLabelText("Supplier receipt") as HTMLInputElement
    const file = new File(["supplier receipt"], "receipt.pdf", { type: "application/pdf" })
    fireEvent.change(receipt, { target: { files: [file] } })
    fireEvent.click(disclosure)
    expect(screen.queryByRole("button", { name: "Review bill" })).toBeNull()
    fireEvent.click(disclosure)
    expect(screen.getByLabelText("Supplier receipt")).toBe(receipt)
    expect(receipt.files?.[0]).toBe(file)
    expect(screen.queryByText("OTHER-COMPANY-BILL")).toBeNull()
  })

  it("shows unavailable intake status instead of a zero count and preserves source recovery", () => {
    const retry = vi.fn()
    const billRows = rows.map((row) => ({ ...row, moveType: "InInvoice" }))
    const { rerender } = render(<BillsListView worklistScope={scope} bills={billRows} currencyOptions={currencies}
      intake={{ lines: [], sourceState: { status: "error", onRetry: retry } }} />)
    expect(screen.getByTestId("bill-intake-summary").textContent).toBe("Records could not be loaded.")
    expect(screen.getByTestId("bill-intake-summary").textContent).not.toContain("0")
    fireEvent.click(screen.getByRole("button", { name: "Bill intake review" }))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<BillsListView worklistScope={scope} bills={billRows} currencyOptions={currencies}
      intake={{ lines: [{ id: 100, moveId: 10 }], sourceState: { status: "ready" } }} />)
    expect(screen.getByTestId("bill-intake-summary").textContent).toContain("ownership is incomplete")
    expect(screen.queryByRole("button", { name: "Review bill" })).toBeNull()
  })

  it("applies controlled exact-ID filters and updates on browser navigation", () => {
    const { rerender } = render(
      <InvoiceListView
        worklistScope={scope}
        invoices={rows}
        initialFilters={{ id: "1" }}
        currencyOptions={currencies}
      />
    )
    expect(screen.getByTestId("entity-row-1")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-10")).toBeNull()
    rerender(
      <InvoiceListView
        worklistScope={scope}
        invoices={rows}
        initialFilters={{ state: "Draft" }}
        currencyOptions={currencies}
      />
    )
    expect(screen.queryByTestId("entity-row-1")).toBeNull()
    expect(screen.getByTestId("entity-row-10")).toBeTruthy()
  })

  it("offers a keyboard-accessible document anchor and preserves row quick preview", () => {
    const preview = vi.fn()
    render(
      <InvoiceListView
        worklistScope={scope}
        invoices={rows}
        onSelectInvoice={preview}
        currencyOptions={currencies}
      />
    )
    const row = screen.getByTestId("entity-row-1")
    expect(
      within(row).getByRole("link", { name: "INV-1" }).getAttribute("href")
    ).toBe("/accounting/invoices/1")
    fireEvent.click(row)
    expect(preview).toHaveBeenCalledWith(rows[0])
  })

  it("removes unsupported menu actions and shows only a real preview action", async () => {
    render(
      <InvoiceListView
        worklistScope={scope}
        invoices={rows}
        onSelectInvoice={vi.fn()}
        currencyOptions={currencies}
      />
    )
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Actions for INV-1" }),
      { key: "Enter" }
    )
    expect(
      await screen.findByRole("menuitem", {
        name: "accounting.invoices.invoiceActions.viewDetails",
      })
    ).toBeTruthy()
    expect(screen.getAllByRole("menuitem")).toHaveLength(1)
  })

  it("shows individual currency totals and does not label the mixed sum as dollars", () => {
    render(
      <BillsListView
        worklistScope={scope}
        bills={rows}
        currencyOptions={currencies}
      />
    )
    const totals = screen.getByLabelText("Totals by currency")
    const euro = within(totals).getByText("Euro").closest("dl")!
    const dollars = within(totals).getByText("US Dollar").closest("dl")!
    expect(euro.textContent).toMatch(/EUR\s100\.00/)
    expect(euro.textContent).toMatch(/EUR\s50\.00/)
    expect(dollars.textContent).toMatch(/USD\s30\.00/)
    expect(screen.getByRole("table").compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByLabelText("Totals by currency").textContent).toContain(
      "EUR"
    )
    expect(screen.getByLabelText("Totals by currency").textContent).toContain(
      "USD"
    )
    expect(
      within(screen.getByTestId("entity-row-1")).getAllByText(/EUR/)
    ).toHaveLength(2)
  })

  it("hides create controls without permission or a callback", () => {
    permissions.create = false
    const { rerender } = render(
      <BillsListView
        worklistScope={scope}
        bills={rows}
        onCreateBill={vi.fn()}
      />
    )
    expect(
      screen.queryByRole("button", { name: "accounting.actions.newBill" })
    ).toBeNull()
    permissions.create = true
    rerender(<BillsListView worklistScope={scope} bills={rows} />)
    expect(
      screen.queryByRole("button", { name: "accounting.actions.newBill" })
    ).toBeNull()
  })

  it("exposes active URL filters and delegates removal without changing local URL state", () => {
    const clear = vi.fn()
    render(
      <InvoiceListView
        worklistScope={scope}
        invoices={rows}
        initialFilters={{ queue: "open" }}
        onInitialFilterClear={clear}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Clear Balance queue filter" }))
    expect(clear).toHaveBeenCalledWith("queue")
    expect(screen.getByTestId("entity-row-1")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-10")).toBeNull()
  })
})
