// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { decodeAccountMovesQueryResponse } from "@lumiere/stdb/resource-reads"

import { GeneralLedgerView } from "./general-ledger-view"

const search = vi.hoisted(() => ({ params: null as URLSearchParams | null }))
vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }))

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; id?: string }) =>
      options?.defaultValue?.replace("{{id}}", options.id ?? "") ?? key,
  }),
}))

vi.mock("../lib/module-url-filters", () => ({
  useModuleUrlFilters: () => ({}),
  useClearModuleUrlFilter: () => vi.fn(),
}))

vi.mock("../lib/currency-context", () => ({
  useCurrencyFormat: () => ({
    money: (amount: number, currencyId?: number) => `${currencyId}: ${amount}`,
    date: (value: number) => String(value),
  }),
}))

afterEach(() => {
  search.params = null
  cleanup()
})

describe("GeneralLedgerView accounting migration actions", () => {
  it("shows only the authorized-company journal rows in an import batch link", () => {
    search.params = new URLSearchParams(
      "importEntryCompany=3&importEntryIds=7,8",
    )
    const move = { state: "Draft", moveType: "Entry" }
    render(
      <GeneralLedgerView
        moves={[
          { ...move, id: 7, companyId: 3, name: "Imported journal" },
          { ...move, id: 8, companyId: 4, name: "Different company" },
          { ...move, id: 9, companyId: 3, name: "Different imported batch" },
        ]}
      />,
    )
    expect(
      screen.getByRole("button", { name: "Imported journal" }),
    ).toBeTruthy()
    expect(screen.queryByText("Different company")).toBeNull()
    expect(screen.queryByText("Different imported batch")).toBeNull()
    expect(
      screen
        .getByRole("link", { name: "Show all journal entries" })
        .getAttribute("href"),
    ).toBe("/accounting?tab=journal-entries")
  })
  it("exposes residual-only import while payment replay is not callable", () => {
    const onImportOutstandingDocumentsCsv = vi.fn()

    render(
      <GeneralLedgerView
        moves={[]}
        onImportOutstandingDocumentsCsv={onImportOutstandingDocumentsCsv}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "accounting.csvImport.toolbarOutstandingDocuments",
      }),
    )
    expect(onImportOutstandingDocumentsCsv).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", {
        name: "accounting.csvImport.toolbarHistoricalDocumentsForPaymentReplay",
      }),
    ).toBeNull()
  })
  it("posts a selected draft vendor bill using the ledger action", () => {
    const onPostMove = vi.fn()
    const move = { id: 7, name: "BILL7", state: "Draft", moveType: "InInvoice" }

    render(<GeneralLedgerView moves={[move]} onPostMove={onPostMove} />)

    fireEvent.click(screen.getByTestId("entity-row-7"))
    fireEvent.click(screen.getByTestId("general-ledger-post-move"))

    expect(onPostMove).toHaveBeenCalledExactlyOnceWith(move)
  })
})

describe("GeneralLedgerView enum display", () => {
  it.each([
    ["string", (tag: string) => tag],
    ["generated", (tag: string) => ({ tag })],
    ["SATS", (tag: string) => ({ [tag.toLowerCase()]: [] })],
  ] as const)(
    "counts and displays %s states and types",
    (_shape, enumValue) => {
      render(
        <GeneralLedgerView
          moves={[
            {
              id: 1,
              name: "Draft journal",
              state: enumValue("Draft"),
              moveType: enumValue("Entry"),
            },
            {
              id: 2,
              name: "Posted journal",
              state: enumValue("Posted"),
              moveType: enumValue("Entry"),
            },
            {
              id: 3,
              name: "Another draft",
              state: enumValue("Draft"),
              moveType: enumValue("Entry"),
            },
          ]}
        />,
      )
      expect(
        screen.getAllByText("accounting.states.draft")[0].nextElementSibling
          ?.textContent,
      ).toBe("2")
      expect(
        screen.getAllByText("accounting.states.posted")[0].nextElementSibling
          ?.textContent,
      ).toBe("1")
      const draftRow = screen.getByTestId("entity-row-1")
      const postedRow = screen.getByTestId("entity-row-2")
      expect(
        within(draftRow).getByText("accounting.journalEntries.types.entry"),
      ).toBeTruthy()
      expect(
        within(postedRow).getByText("accounting.states.posted"),
      ).toBeTruthy()
      fireEvent.click(postedRow)
      const detail = within(screen.getByRole("dialog"))
      expect(
        detail.getByText("accounting.journalEntries.types.entry"),
      ).toBeTruthy()
      expect(detail.getByText("accounting.states.posted")).toBeTruthy()
      expect(screen.queryByText("[object Object]")).toBeNull()
    },
  )

  it("shows the actual generated payment state and keeps missing amounts and partner distinct from zero", () => {
    const moves = decodeAccountMovesQueryResponse({
      data: [
        {
          id: "21",
          organizationId: 11,
          companyId: 42,
          currencyId: 1,
          name: "INV/2026/0021",
          moveType: "OutInvoice",
          state: "Posted",
          partnerId: null,
          amountTotal: 0,
          paymentState: "Partial",
        },
      ],
    })
    render(<GeneralLedgerView moves={moves} />)

    fireEvent.click(screen.getByRole("button", { name: "INV/2026/0021" }))
    const detail = within(screen.getByRole("dialog", { name: "INV/2026/0021" }))
    expect(detail.getByText("Partial")).toBeTruthy()
    expect(
      detail.getByText("accounting.journalEntries.partner").nextElementSibling
        ?.textContent,
    ).toBe("—")
    expect(
      detail.getByText("accounting.journalEntries.total").nextElementSibling
        ?.textContent,
    ).toBe("1: 0")
    expect(
      detail.getByText("accounting.journalEntries.residual").nextElementSibling
        ?.textContent,
    ).toBe("—")
  })

  it.each([
    [{ tag: "Partial" }, "Partial"],
    [{ some: { notPaid: [] } }, "Not paid"],
    ["InPayment", "In payment"],
    [{ tag: "FuturePaymentState" }, "Status unavailable"],
    [null, "—"],
  ] as const)(
    "renders transport payment value %j with a readable label",
    (paymentState, label) => {
      const partnerId = 18_446_744_073_709_551_615n
      const moves = [
        {
          id: 1n,
          name: "INV-1",
          moveType: { tag: "OutInvoice" },
          state: { tag: "Cancelled" },
          paymentState,
          partnerId,
        },
      ]
      const { rerender } = render(
        <GeneralLedgerView
          moves={moves}
          partnerLabels={new Map([[String(partnerId), "Acme Supply"]])}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: "INV-1" }))
      const detail = within(screen.getByRole("dialog"))
      expect(
        detail.getByText("accounting.journalEntries.payment").nextElementSibling
          ?.textContent,
      ).toBe(label)
      expect(detail.getByText("accounting.states.cancelled")).toBeTruthy()
      expect(detail.getByText("Acme Supply")).toBeTruthy()
      rerender(<GeneralLedgerView moves={moves} />)
      expect(detail.getByText(`Partner #${partnerId}`)).toBeTruthy()
    },
  )

  it("distinguishes dismissing the dialog from cancelling the selected entry", () => {
    const move = {
      id: 7,
      name: "Draft journal",
      state: { tag: "Draft" },
      moveType: { tag: "Entry" },
    }
    const onCancelMove = vi.fn()
    const { rerender } = render(
      <GeneralLedgerView moves={[move]} onCancelMove={onCancelMove} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Draft journal" }))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onCancelMove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Draft journal" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel entry" }))
    expect(onCancelMove).toHaveBeenCalledExactlyOnceWith(move)
    rerender(
      <GeneralLedgerView
        moves={[{ ...move, state: { tag: "Cancelled" } }]}
        onCancelMove={onCancelMove}
      />,
    )
    expect(screen.queryByRole("button", { name: "Cancel entry" })).toBeNull()
    expect(
      within(screen.getByRole("dialog")).getByText(
        "accounting.states.cancelled",
      ),
    ).toBeTruthy()
  })
})

it("shows a balanced journal amount from its company lines and leaves missing lines unknown", () => {
  const move = {
    id: 7,
    companyId: 2,
    companyCurrencyId: 4,
    name: "Electricity",
    date: { microsSinceUnixEpoch: 1_716_000_000_000_000n },
    state: "Draft",
    moveType: "Entry",
    amountTotal: 0,
  }
  const { rerender } = render(<GeneralLedgerView moves={[move]} />)
  const row = () => within(screen.getByTestId("entity-row-7"))
  expect(row().getAllByRole("cell")[4]?.textContent).toBe("—")
  rerender(<GeneralLedgerView moves={[move]} moveLines={[]} />)
  expect(row().getAllByRole("cell")[4]?.textContent).toBe("—")

  const moveLines = [
    {
      id: 8,
      companyId: 2,
      companyCurrencyId: 4,
      moveId: 7,
      debit: 6100,
      credit: 0,
    },
    {
      id: 9,
      companyId: 2,
      companyCurrencyId: 4,
      moveId: 7,
      debit: 0,
      credit: 6100,
    },
    {
      id: 10,
      companyId: 3,
      companyCurrencyId: 4,
      moveId: 7,
      debit: 99,
      credit: 0,
    },
  ]
  rerender(<GeneralLedgerView moves={[move]} moveLines={moveLines} />)
  expect(row().getByText("4: 6100")).toBeTruthy()
  fireEvent.click(screen.getByTestId("entity-row-7"))
  const dialog = within(screen.getByRole("dialog"))
  expect(
    dialog.getByText("accounting.journalEntries.total").nextElementSibling
      ?.textContent,
  ).toBe("4: 6100")
  expect(
    within(
      dialog.getByRole("table", { name: "accounting.tabs.moveLines" }),
    ).getAllByRole("row"),
  ).toHaveLength(3)
  rerender(
    <GeneralLedgerView
      moves={[move]}
      moveLines={[{ ...moveLines[0]!, debit: 0 }]}
    />,
  )
  expect(row().getByText("4: 0")).toBeTruthy()
})
