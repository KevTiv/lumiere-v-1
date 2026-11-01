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
