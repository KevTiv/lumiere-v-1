import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { CustomField } from "../lib/form-types"
import { ReconciliationMoveLinePicker, ReconciliationMoveLineProvider } from "./reconciliation-move-line-picker"

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined") Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
})
afterEach(cleanup)

const field: CustomField = { id: "moveLineIds", name: "moveLineIds", type: "custom", component: ReconciliationMoveLinePicker }
const context = {
  organizationId: "1", companyId: "10", ready: true,
  lines: [
    { id: 40n, organizationId: 1n, companyId: 10n, accountId: 20n, partnerId: 30n, moveName: "INV/001", name: "Consulting", debit: 100, credit: 0 },
    { id: 41n, organizationId: 1n, companyId: 10n, accountId: 20n, partnerId: 30n, moveName: "INV/002", name: "Training", debit: 200, credit: 0 },
    { id: 42n, organizationId: 1n, companyId: 10n, accountId: 21n, partnerId: 30n, moveName: "OTHER", name: "Other account", debit: 100, credit: 0 },
    { id: 43n, organizationId: 1n, companyId: 11n, accountId: 20n, partnerId: 30n, moveName: "FOREIGN", name: "Other company", debit: 100, credit: 0 },
  ],
}

describe("ReconciliationMoveLinePicker", () => {
  it("searches matching named journal items and returns selected IDs as an array", async () => {
    const onChange = vi.fn()
    render(<ReconciliationMoveLineProvider value={context}>
      <ReconciliationMoveLinePicker field={field} values={{ accountId: "20", partnerId: "30" }} value={[]} onChange={onChange} />
    </ReconciliationMoveLineProvider>)
    fireEvent.click(screen.getByTestId("form-field-moveLineIds"))
    expect(await screen.findByRole("option", { name: /Consulting/ })).toBeTruthy()
    expect(screen.queryByRole("option", { name: /Other account/ })).toBeNull()
    expect(screen.queryByRole("option", { name: /Other company/ })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText("Search journal items"), { target: { value: "Training" } })
    await waitFor(() => expect(screen.queryByRole("option", { name: /Consulting/ })).toBeNull())
    fireEvent.click(screen.getByRole("option", { name: /Training/ }))
    expect(onChange).toHaveBeenCalledWith(["41"])
  })

  it("keeps stale selections visible and removes them only on an explicit action", () => {
    const onChange = vi.fn()
    const { rerender } = render(<ReconciliationMoveLineProvider value={context}>
      <ReconciliationMoveLinePicker field={field} values={{ accountId: "20", partnerId: "30" }} value={["40"]} onChange={onChange} />
    </ReconciliationMoveLineProvider>)
    expect(screen.getByText(/INV\/001/)).toBeTruthy()
    rerender(<ReconciliationMoveLineProvider value={context}>
      <ReconciliationMoveLinePicker field={field} values={{ accountId: "21", partnerId: "30" }} value={["40"]} onChange={onChange} />
    </ReconciliationMoveLineProvider>)
    expect(screen.getByText("Unavailable journal item #40")).toBeTruthy()
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Remove journal item #40" }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it("fails closed without loaded lookup context", () => {
    render(<ReconciliationMoveLinePicker field={field} values={{ accountId: "20" }} value={["9007199254740993"]} onChange={vi.fn()} />)
    expect(screen.getByTestId("form-field-moveLineIds").hasAttribute("disabled")).toBe(true)
    expect(screen.getByText("Unavailable journal item #9007199254740993")).toBeTruthy()
    expect(screen.getByText(/choices are unavailable until the company data is loaded/)).toBeTruthy()
  })
})
