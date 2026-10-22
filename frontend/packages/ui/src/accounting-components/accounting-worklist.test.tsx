import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AccountMove } from "../lib/accounting-types"
import { accountingWorklistKey } from "./accounting-worklist-model"

const permission = vi.hoisted(() => ({ allowed: true }))
vi.mock("../lib/rbac-context", () => ({
  useRBAC: () => ({ checkPermission: () => ({ allowed: permission.allowed }) }),
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: vi.fn() }))
import { InvoiceListView } from "./invoice-list-view"
import { BillsListView } from "./bills-list-view"

const scope = { organizationId: 1n, companyId: 2n, userId: "alpha" }
const currencies = [
  { value: "7", code: "EUR", label: "Euro" },
  { value: "8", code: "USD", label: "US Dollar" },
]
const rows: AccountMove[] = [
  {
    id: "9007199254740992",
    organizationId: 1n,
    companyId: 2n,
    name: "INV-old",
    invoicePartnerDisplayName: "Acme",
    state: "Posted",
    paymentState: "NotPaid",
    amountTotal: 100,
    amountResidual: 50,
    currencyId: 7n,
  },
  {
    id: "9007199254740993",
    organizationId: 1n,
    companyId: 2n,
    name: "INV-new",
    invoicePartnerDisplayName: "North",
    state: "Draft",
    amountTotal: 20,
    amountResidual: 20,
    currencyId: 8n,
  },
  {
    id: "9",
    organizationId: 1n,
    companyId: 3n,
    name: "OTHER-COMPANY",
    state: "Draft",
    amountTotal: 999,
    currencyId: 7n,
  },
]
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  permission.allowed = true
})

describe("scoped accounting worklists", () => {
  it("uses the shared engine's exact u64 order and canonical links with original quick-preview callbacks", async () => {
    const preview = vi.fn()
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
        onSelectInvoice={preview}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    expect(screen.queryByText("OTHER-COMPANY")).toBeNull()
    const bodyRows = screen.getAllByTestId(/^entity-row-/)
    expect(bodyRows.map((row) => row.dataset.testid)).toEqual([
      "entity-row-9007199254740993",
      "entity-row-9007199254740992",
    ])
    expect(within(bodyRows[0]!).getByRole("link").getAttribute("href")).toBe(
      "/accounting/invoices/9007199254740993"
    )
    fireEvent.keyDown(bodyRows[0]!, { key: "Enter" })
    expect(preview).toHaveBeenCalledWith(rows[1])
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-old" }))
    expect(screen.getByRole("button", { name: "Export selected" })).toBeTruthy()
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it("persists named filters and column choices without overriding exact URL filters", async () => {
    const clear = vi.fn()
    const { rerender } = render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
        initialFilters={{ id: rows[0]!.id.toString(), status: "sent" }}
        onInitialFilterClear={clear}
      />
    )
    await screen.findByTestId("entity-row-9007199254740992")
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "Acme" },
    })
    fireEvent.keyDown(screen.getByRole("button", { name: "Columns" }), {
      key: "Enter",
    })
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", {
        name: "accounting.invoices.dueDate",
      })
    )
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "My receivables" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save view" }))
    const stored = JSON.parse(
      window.localStorage.getItem(accountingWorklistKey(scope, "invoice")!)!
    )
    expect(stored.saved[0].hiddenColumns).toContain("dueDate")
    expect(stored.saved[0].search).toBe("Acme")
    expect(stored.saved[0].filters).not.toHaveProperty("id")
    expect(JSON.stringify(stored)).not.toContain("9007199254740992")
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "" },
    })
    fireEvent.change(screen.getByRole("combobox", { name: "Saved views" }), {
      target: { value: "My receivables" },
    })
    expect(screen.getByTestId("entity-row-9007199254740992")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-9007199254740993")).toBeNull()
    expect(clear).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("combobox", { name: "accounting.journalEntries.state" })
        .hasAttribute("disabled")
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Clear status filter" }))
    expect(clear).toHaveBeenCalledWith("status")
    rerender(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
        initialFilters={{ search: "North" }}
      />
    )
    const search = screen.getByRole("textbox", {
      name: "Search",
    }) as HTMLInputElement
    expect(search.value).toBe("North")
    expect(search.disabled).toBe(true)
    expect(screen.getByTestId("entity-row-9007199254740993")).toBeTruthy()
  })

  it("separates company, user and bill preferences and never flashes prior company rows", async () => {
    const { rerender } = render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "Acme" },
    })
    rerender(
      <InvoiceListView
        invoices={rows}
        worklistScope={{ ...scope, companyId: 3n }}
        currencyOptions={currencies}
      />
    )
    expect(screen.queryByTestId("entity-row-9007199254740992")).toBeNull()
    await screen.findByText("OTHER-COMPANY")
    expect(
      (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement)
        .value
    ).toBe("")
    rerender(
      <InvoiceListView
        invoices={rows}
        worklistScope={{ ...scope, userId: "other-user" }}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    expect(
      (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement)
        .value
    ).toBe("")
    rerender(
      <BillsListView
        bills={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    expect(
      (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement)
        .value
    ).toBe("")
    rerender(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740992")
    expect(
      (screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement)
        .value
    ).toBe("Acme")
  })

  it("hides cached monetary summaries, rows and actions on loading, denied, partial and error", async () => {
    const create = vi.fn()
    const { rerender } = render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
        onCreateInvoice={create}
      />
    )
    await screen.findByLabelText("Totals by currency")
    for (const status of ["loading", "denied", "partial", "error"] as const) {
      rerender(
        <InvoiceListView
          invoices={rows}
          worklistScope={scope}
          currencyOptions={currencies}
          onCreateInvoice={create}
          sourceState={{ status }}
        />
      )
      expect(screen.queryByLabelText("Totals by currency")).toBeNull()
      expect(screen.queryByRole("link", { name: "INV-old" })).toBeNull()
      expect(
        screen.queryByRole("button", { name: "accounting.actions.newInvoice" })
      ).toBeNull()
    }
    expect(create).not.toHaveBeenCalled()
  })

  it("requires explicit scope and refuses an indeterminate redacted scope instead of empty success", () => {
    const { rerender } = render(<InvoiceListView invoices={rows} />)
    expect(screen.getByRole("alert").textContent).toContain(
      "Select an organization and company"
    )
    rerender(
      <InvoiceListView
        invoices={[{ ...rows[0]!, companyId: undefined }]}
        worklistScope={scope}
      />
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "Record identity or company scope is unavailable"
    )
    expect(screen.queryByTestId("entity-empty-first-time")).toBeNull()
  })

  it("keeps volatile saved views usable when browser storage is blocked or identity unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError")
    })
    const write = vi.spyOn(Storage.prototype, "setItem")
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    expect(screen.getByText(/session only/)).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Session view" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save view" }))
    expect(screen.getByRole("option", { name: "Session view" })).toBeTruthy()
    expect(write).not.toHaveBeenCalled()
    cleanup()
    vi.restoreAllMocks()
    const anonymousWrite = vi.spyOn(Storage.prototype, "setItem")
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={{ ...scope, userId: null }}
        currencyOptions={currencies}
      />
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "Acme" },
    })
    expect(anonymousWrite).not.toHaveBeenCalled()
  })

  it("keeps missing amounts/currency unavailable and isolates mixed-currency totals", async () => {
    render(
      <InvoiceListView
        invoices={[
          ...rows,
          {
            ...rows[0]!,
            id: "11",
            currencyId: undefined,
            amountTotal: undefined,
            amountResidual: undefined,
          },
        ]}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-11")
    expect(screen.getByTestId("kpi-tile-invoiced-value").textContent).toBe(
      "Currency not available"
    )
    const unknown = screen.getByTestId("entity-row-11")
    expect(within(unknown).getByText("Unavailable")).toBeTruthy()
    expect(within(unknown).getAllByText("—").length).toBeGreaterThanOrEqual(3)
    const totals = screen.getByLabelText("Totals by currency")
    expect(totals.textContent).toContain("EUR")
    expect(totals.textContent).toContain("USD")
    expect(totals.textContent).not.toContain("EUR 120")
  })

  it("exports only selected in-scope records through EntityTable's guarded CSV engine", async () => {
    const urls: Blob[] = []
    const createUrl = vi.fn((blob: Blob) => {
      urls.push(blob)
      return "blob:test"
    })
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createUrl
        static revokeObjectURL = vi.fn()
      }
    )
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    fireEvent.keyDown(screen.getByRole("button", { name: "Columns" }), {
      key: "Enter",
    })
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Currency" })
    )
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    fireEvent.click(screen.getByRole("checkbox", { name: "Select INV-old" }))
    fireEvent.click(screen.getByRole("button", { name: "Export selected" }))
    await waitFor(() => expect(urls).toHaveLength(1))
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(urls[0]!)
    })
    expect(csv).toContain("INV-old")
    expect(csv).toContain("Euro")
    expect(csv).not.toContain("INV-new")
    expect(csv).not.toContain("OTHER-COMPANY")
    vi.unstubAllGlobals()
  })
})
