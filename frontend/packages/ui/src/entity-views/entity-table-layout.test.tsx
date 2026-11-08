import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { MouseEvent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CurrencyFormatProvider } from "../lib/currency-context"
import type { EntityColumn } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"
import { allocateEntityColumnWidths } from "./entity-table-layout"

const columns: EntityColumn[] = [
  { key: "name", label: "Name", layout: { min: 12, preferred: 16, max: 20, grow: 2, wrap: 2 } },
  { key: "sku", label: "SKU", layout: { min: 8, preferred: 10, max: 18, grow: 1, wrap: 1 } },
  { key: "amount", label: "Amount", type: "currency", currencyKey: "currency", align: "right", layout: { min: 10, preferred: 12, max: 12, wrap: "wrap" } },
  { key: "notes", label: "Notes", defaultHidden: true, width: "min-w-40" },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("entity table allocation", () => {
  it("preserves minimums on narrow hosts and reallocates spare width after hitting a maximum", () => {
    expect(allocateEntityColumnWidths(columns, 20)).toEqual([12, 8, 10, 10])
    expect(allocateEntityColumnWidths(columns, 44)).toEqual([14, 9, 11, 10])
    expect(allocateEntityColumnWidths(columns, 60)).toEqual([20, 14, 12, 14])
    expect(allocateEntityColumnWidths(columns.slice(2, 3), 6)).toEqual([10])
    expect(allocateEntityColumnWidths([{ key: "unit", label: "Unit", layout: { min: 4, max: 4 } }], 3)).toEqual([4])
  })

  it("discloses only the clipped value and keeps its row action separate", async () => {
    const longName = "日本語の顧客 Sønderborg Société internationale de composants"
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.textContent === longName ? 60 : 0
    })
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(30)
    const openRow = vi.fn()
    const data = Array.from({ length: 28 }, (_, index) => ({
      id: String(index),
      name: index === 27 ? longName : `Product ${index + 1}`,
      sku: index === 26 ? "SKU1234567890".repeat(8) : `SKU-${index + 1}`,
      amount: index === 27 ? -1_234_567.89 : 0,
      currency: "EUR",
    }))

    render(
      <RBACProvider>
        <CurrencyFormatProvider locale="en-US" defaultCode="USD">
          <EntityTable config={{ mode: "table", columns }} data={data} onRowClick={openRow} />
        </CurrencyFormatProvider>
      </RBACProvider>,
    )

    const viewport = screen.getByRole("region", { name: "Records" })
    expect(within(viewport).getAllByRole("columnheader")).toHaveLength(3)
    expect(within(screen.getByTestId("entity-row-27")).getAllByRole("cell").at(-1)?.textContent).toBe("(€1,234,567.89)")
    expect(screen.queryByRole("button", { name: "Product 2" })).toBeNull()
    const disclosure = screen.getByRole("button", { name: longName })
    disclosure.focus()
    expect(document.activeElement).toBe(disclosure)
    fireEvent.click(disclosure)
    expect(await screen.findByRole("dialog", { name: "Name" })).toBeTruthy()
    expect(within(screen.getByRole("dialog")).getByText(longName)).toBeTruthy()
    expect(openRow).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText("Go to next page"))
    expect(within(viewport).getByText("Product 1")).toBeTruthy()
  })

  it("preserves the navigation and exposes disclosure separately for a clipped link", async () => {
    const reference = "SO-2026-" + "00124".repeat(14)
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(42)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(21)
    const followLink = vi.fn((event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    })
    const openRow = vi.fn()

    render(
      <RBACProvider>
        <EntityTable config={{
          mode: "table",
          columns: [{
            key: "name",
            label: "Reference",
            layout: { min: 7, wrap: 1 },
            render: () => <a href="/sales?filter=id%3A12" onClick={followLink}>{reference}</a>,
          }],
        }} data={[{ id: "1" }]} onRowClick={openRow} />
      </RBACProvider>,
    )

    const link = screen.getByRole("link", { name: reference })
    expect(link.getAttribute("href")).toBe("/sales?filter=id%3A12")
    const disclose = screen.getByRole("button", { name: "Show full value: Reference" })
    expect(link.contains(disclose)).toBe(false)
    fireEvent.click(disclose)
    expect(await screen.findByRole("dialog", { name: "Reference" })).toBeTruthy()
    expect(within(screen.getByRole("dialog")).getByText(reference)).toBeTruthy()
    expect(followLink).not.toHaveBeenCalled()
    fireEvent.click(link)
    expect(followLink).toHaveBeenCalledOnce()
    expect(openRow).not.toHaveBeenCalled()
  })
})
