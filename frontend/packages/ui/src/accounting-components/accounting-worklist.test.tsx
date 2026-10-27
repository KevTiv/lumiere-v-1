import { chooseSelectValue } from "../components/select-test-utils"
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
import { readRecordListContext, readRecordListReturnContext } from "../lib/record-list-context"

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
  window.sessionStorage.clear()
  window.history.replaceState({}, "", "/")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  permission.allowed = true
})

describe("scoped accounting worklists", () => {
  it("returns to the captured scoped sort, page, scroll and row focus after preferences load", async () => {
    window.history.replaceState({}, "", "/accounting?tab=invoices&filter=currencyId%3A7&keep=alpha")
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...rows[0]!, id: String(index + 1), name: `Return ${String(index + 1).padStart(3, "0")}`,
    }))
    const view = () => <main data-slot="sidebar-inset" data-testid="return-scroll"><InvoiceListView invoices={many} worklistScope={scope} currencyOptions={currencies} initialFilters={{ currencyId: "7" }} /></main>
    const first = render(view())
    await screen.findByTestId("entity-row-60")
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Return" } })
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "accounting.invoices.title" }))
    fireEvent.click(screen.getByRole("button", { name: "Next", exact: true }))
    const link = within(screen.getByTestId("entity-row-26")).getByRole("link")
    link.addEventListener("click", (event) => event.preventDefault())
    screen.getByTestId("return-scroll").scrollTop = 240
    screen.getByRole("table").parentElement!.scrollLeft = 120
    fireEvent.click(link)
    const key = accountingWorklistKey(scope, "invoice")!
    expect(readRecordListReturnContext("/accounting/invoices", { key, recordId: "26" })).toMatchObject({
      page: 2, rowId: "26", sorting: [{ id: "name", desc: false }], scrollTop: 240, scrollLeft: 120,
    })
    first.unmount()

    const returned = render(view())
    const restored = await screen.findByTestId("entity-row-26")
    await waitFor(() => expect(document.activeElement).toBe(within(restored).getByRole("link")))
    expect(screen.getByTestId("return-scroll").scrollTop).toBe(240)
    expect(screen.getByRole("table").parentElement!.scrollLeft).toBe(120)
    expect(screen.getByRole("textbox", { name: "Search" }).getAttribute("value")).toBe("Return")
    expect(readRecordListReturnContext("/accounting/invoices", { key })).toBeUndefined()
    expect(readRecordListContext("/accounting/invoices")?.slice(0, 3)).toEqual(["1", "2", "3"])
    returned.unmount()

    render(view())
    await screen.findByTestId("entity-row-60")
    expect(screen.queryByTestId("entity-row-26")).toBeNull()
  })

  it("keeps filters and records visible while disclosing view setup and row density", async () => {
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    expect(screen.getByRole("textbox", { name: "Search" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Balance queue" })).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Saved views" })).toBeNull()
    expect(screen.queryByTestId("table-density")).toBeNull()
    const disclosure = screen.getByRole("button", { name: "View settings" })
    expect(disclosure.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(disclosure)
    expect(disclosure.getAttribute("aria-expanded")).toBe("true")
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Unfinished view" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Compact" }))
    expect(
      screen.getByTestId("finance-money-list").getAttribute("data-density")
    ).toBe("compact")
    fireEvent.click(disclosure)
    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull()
    expect(screen.getByTestId("entity-row-9007199254740993")).toBeTruthy()
    fireEvent.click(disclosure)
    expect(
      (screen.getByRole("textbox", { name: "View name" }) as HTMLInputElement)
        .value
    ).toBe("Unfinished view")
    const table = screen.getByRole("table")
    const totals = screen.getByLabelText("Totals by currency")
    expect(
      table.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("filters through shared status and currency options and clears them without changing scope", async () => {
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
      />
    )
    await screen.findByTestId("entity-row-9007199254740993")
    chooseSelectValue(screen.getByRole("combobox", { name: "Currency" }), "7")
    expect(screen.getByTestId("entity-row-9007199254740992")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-9007199254740993")).toBeNull()
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Currency" }),
      "__none__"
    )
    chooseSelectValue(
      screen.getByRole("combobox", { name: "accounting.journalEntries.state" }),
      "draft"
    )
    expect(screen.getByTestId("entity-row-9007199254740993")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-9007199254740992")).toBeNull()
    chooseSelectValue(
      screen.getByRole("combobox", { name: "accounting.journalEntries.state" }),
      "__none__"
    )
    expect(screen.getAllByTestId(/^entity-row-/)).toHaveLength(2)
    expect(screen.queryByText("OTHER-COMPANY")).toBeNull()
  })

  it("labels linked currency filters while retaining unknown exact filters and clear keys", async () => {
    const clear = vi.fn()
    render(
      <InvoiceListView
        invoices={rows}
        worklistScope={scope}
        currencyOptions={currencies}
        initialFilters={{ currencyId: "7", external_exact: "9007199254740993" }}
        onInitialFilterClear={clear}
      />
    )
    const filters = await screen.findByLabelText("Linked record filters")
    expect(filters.textContent).toContain("Currency: Euro")
    expect(filters.textContent).toContain("external_exact: 9007199254740993")
    expect(filters.textContent).not.toContain("currencyId:")
    fireEvent.click(
      within(filters).getByRole("button", { name: "Clear Currency filter" })
    )
    expect(clear).toHaveBeenCalledWith("currencyId")
    fireEvent.click(
      within(filters).getByRole("button", {
        name: "Clear external_exact filter",
      })
    )
    expect(clear).toHaveBeenCalledWith("external_exact")
  })

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
    fireEvent.click(screen.getByRole("button", { name: "View settings" }))
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
      target: { value: "__none__" },
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
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Saved views" }),
      "saved:__none__"
    )
    expect(screen.getByTestId("entity-row-9007199254740992")).toBeTruthy()
    expect(screen.queryByTestId("entity-row-9007199254740993")).toBeNull()
    expect(clear).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole("combobox", { name: "accounting.journalEntries.state" })
        .hasAttribute("disabled")
    ).toBe(true)
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear accounting.journalEntries.state filter",
      })
    )
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
    fireEvent.click(screen.getByRole("button", { name: "View settings" }))
    expect(screen.getByText(/session only/)).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Session view" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save view" }))
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Saved views" }),
      "saved:Session view"
    )
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
    expect(screen.getByLabelText("Totals by currency").textContent).toContain(
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
    fireEvent.click(screen.getByRole("button", { name: "View settings" }))
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
