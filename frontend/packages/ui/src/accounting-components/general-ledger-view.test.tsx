// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
