// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GeneralLedgerView } from "./general-ledger-view"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

afterEach(cleanup)

describe("GeneralLedgerView accounting migration actions", () => {
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
  ] as const)("counts and displays %s states and types", (_shape, enumValue) => {
    render(<GeneralLedgerView moves={[
      { id: 1, name: "Draft journal", state: enumValue("Draft"), moveType: enumValue("Entry") },
      { id: 2, name: "Posted journal", state: enumValue("Posted"), moveType: enumValue("Entry") },
      { id: 3, name: "Another draft", state: enumValue("Draft"), moveType: enumValue("Entry") },
    ]} />)
    expect(screen.getAllByText("accounting.states.draft")[0].nextElementSibling?.textContent).toBe("2")
    expect(screen.getAllByText("accounting.states.posted")[0].nextElementSibling?.textContent).toBe("1")
    const draftRow = screen.getByTestId("entity-row-1")
    const postedRow = screen.getByTestId("entity-row-2")
    expect(within(draftRow).getByText("Entry")).toBeTruthy()
    expect(within(postedRow).getByText("accounting.states.posted")).toBeTruthy()
    fireEvent.click(postedRow)
    const detail = within(screen.getByRole("dialog"))
    expect(detail.getByText("Entry")).toBeTruthy()
    expect(detail.getByText("accounting.states.posted")).toBeTruthy()
    expect(screen.queryByText("[object Object]")).toBeNull()
  })
})

it("shows a balanced journal amount from its company lines and leaves missing lines unknown", () => {
  const move = { id: 7, companyId: 2, companyCurrencyId: 4, name: "Electricity", date: { microsSinceUnixEpoch: 1_716_000_000_000_000n }, state: "Draft", moveType: "Entry", amountTotal: 0 }
  const { rerender } = render(<GeneralLedgerView moves={[move]} />)
  const row = () => within(screen.getByTestId("entity-row-7"))
  expect(row().getByText("—")).toBeTruthy()
  rerender(<GeneralLedgerView moves={[move]} moveLines={[]} />)
  expect(row().getByText("—")).toBeTruthy()

  const moveLines = [
    { id: 8, companyId: 2, companyCurrencyId: 4, moveId: 7, debit: 6100, credit: 0 },
    { id: 9, companyId: 2, companyCurrencyId: 4, moveId: 7, debit: 0, credit: 6100 },
    { id: 10, companyId: 3, companyCurrencyId: 4, moveId: 7, debit: 99, credit: 0 },
  ]
  rerender(<GeneralLedgerView moves={[move]} moveLines={moveLines} />)
  expect(row().getByText("4: 6100")).toBeTruthy()
  fireEvent.click(screen.getByTestId("entity-row-7"))
  expect(within(screen.getByRole("dialog")).getByText("4: 6100")).toBeTruthy()
  rerender(<GeneralLedgerView moves={[move]} moveLines={[{ ...moveLines[0]!, debit: 0 }]} />)
  expect(row().getByText("4: 0")).toBeTruthy()
})
