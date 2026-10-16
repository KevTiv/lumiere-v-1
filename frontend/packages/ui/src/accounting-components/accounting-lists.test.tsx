import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AccountMove } from "../lib/accounting-types"

const permissions = vi.hoisted(() => ({ create: true }))
vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ checkPermission: () => ({ allowed: permissions.create }) }) }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
import { InvoiceListView } from "./invoice-list-view"
import { BillsListView } from "./bills-list-view"

afterEach(() => { cleanup(); permissions.create = true })
const rows: AccountMove[] = [
  { id: 1, name: "INV-1", state: { tag: "Posted" }, moveType: "OutInvoice", amountTotal: 100, amountResidual: 50, currencyId: 7 },
  { id: 10, name: "INV-10", state: { tag: "Draft" }, moveType: "OutInvoice", amountTotal: 30, amountResidual: 30, currencyId: 8 },
] as AccountMove[]
const currencies = [{ value: "7", code: "EUR", label: "Euro" }, { value: "8", code: "USD", label: "US Dollar" }]

describe("accounting document lists", () => {
  it("applies controlled exact-ID filters and updates on browser navigation", () => {
    const { rerender } = render(<InvoiceListView invoices={rows} initialFilters={{ id: "1" }} currencyOptions={currencies} />)
    expect(screen.getByTestId("entity-row-1")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-10")).toBeNull()
    rerender(<InvoiceListView invoices={rows} initialFilters={{ state: "Draft" }} currencyOptions={currencies} />)
    expect(screen.queryByTestId("entity-row-1")).toBeNull()
    expect(screen.getByTestId("entity-row-10")).toBeTruthy()
  })

  it("offers a keyboard-accessible document anchor and preserves row quick preview", () => {
    const preview = vi.fn()
    render(<InvoiceListView invoices={rows} onSelectInvoice={preview} currencyOptions={currencies} />)
    const row = screen.getByTestId("entity-row-1")
    expect(within(row).getByRole("link", { name: "INV-1" }).getAttribute("href")).toBe("/accounting/invoices/1")
    fireEvent.click(row)
    expect(preview).toHaveBeenCalledWith(rows[0])
  })

  it("removes unsupported menu actions and shows only a real preview action", async () => {
    render(<InvoiceListView invoices={rows} onSelectInvoice={vi.fn()} currencyOptions={currencies} />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Actions for INV-1" }), { key: "Enter" })
    expect(await screen.findByRole("menuitem", { name: "accounting.invoices.invoiceActions.viewDetails" })).toBeTruthy()
    expect(screen.getAllByRole("menuitem")).toHaveLength(1)
  })

  it("shows individual currency totals and does not label the mixed sum as dollars", () => {
    render(<BillsListView bills={rows} currencyOptions={currencies} />)
    expect(screen.getByTestId("kpi-tile-billed-value").textContent).toBe("2 currencies")
    expect(screen.getByLabelText("Totals by currency").textContent).toContain("EUR")
    expect(screen.getByLabelText("Totals by currency").textContent).toContain("USD")
    expect(within(screen.getByTestId("entity-row-1")).getAllByText(/EUR/)).toHaveLength(2)
  })

  it("hides create controls without permission or a callback", () => {
    permissions.create = false
    const { rerender } = render(<BillsListView bills={rows} onCreateBill={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "accounting.actions.newBill" })).toBeNull()
    permissions.create = true
    rerender(<BillsListView bills={rows} />)
    expect(screen.queryByRole("button", { name: "accounting.actions.newBill" })).toBeNull()
  })

  it("exposes active URL filters and delegates removal without changing local URL state", () => {
    const clear = vi.fn()
    render(<InvoiceListView invoices={rows} initialFilters={{ queue: "open" }} onInitialFilterClear={clear} />)
    fireEvent.click(screen.getByRole("button", { name: "Clear queue filter" }))
    expect(clear).toHaveBeenCalledWith("queue")
    expect(screen.getByTestId("entity-row-1")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-10")).toBeNull()
  })
})
