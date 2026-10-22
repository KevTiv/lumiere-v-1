import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { RBACProvider } from "../lib/rbac-context"
import { WorkspaceProfileProvider } from "../lib/workspace-profile-context"
import { EntityTable } from "./entity-table"
import type { EntityTableConfig } from "../lib/entity-view-types"
const base: EntityTableConfig = { mode: "table", rowKey: "id", searchable: true, selectable: true, columns: [{ key: "name", label: "Name" }, { key: "amount", label: "Amount", type: "number" }] }
const rows = [{ id: 1, name: "Review bill", amount: 12 }]
function table(key: string, densityOnly = false) { return <WorkspaceProfileProvider value="finance-alpha"><RBACProvider><EntityTable config={{ ...base, listViewKey: densityOnly ? undefined : key }} densityKey={densityOnly ? key : undefined} data={rows} /></RBACProvider></WorkspaceProfileProvider> }
beforeAll(() => { vi.stubGlobal("PointerEvent", MouseEvent) })
beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() } })
})
afterEach(cleanup)
describe("Finance table density", () => {
  it("does not write defaults or attempt persistence when storage reads are blocked", () => {
    const write = vi.spyOn(localStorage, "setItem")
    const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError") })
    render(table("bills", true))
    expect(write).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Compact", exact: true }))
    expect(screen.getByTestId("entity-table").getAttribute("data-density")).toBe("compact")
    expect(write).not.toHaveBeenCalled()
    read.mockRestore()
    write.mockRestore()
  })

  it("preserves selected records while changing density and restores the local preference", async () => {
    const view = render(table("bills"))
    fireEvent.click(screen.getByTestId("entity-select-row-1"))
    fireEvent.click(screen.getByRole("button", { name: "Compact", exact: true }))
    expect(screen.getByTestId("entity-table").getAttribute("data-density")).toBe("compact")
    expect(screen.getByTestId("entity-select-row-1").getAttribute("aria-checked")).toBe("true")
    await waitFor(() => expect(localStorage.getItem("bills:density")).toBe("compact"))
    view.unmount()
    render(table("bills"))
    await waitFor(() => expect(screen.getByTestId("entity-table").getAttribute("data-density")).toBe("compact"))
  })
  it("persists density through a stable list identity without enabling saved filters", async () => {
    const view = render(table("expenses", true))
    fireEvent.click(screen.getByRole("button", { name: "Compact", exact: true }))
    await waitFor(() => expect(localStorage.getItem("expenses:density")).toBe("compact"))
    expect(localStorage.getItem("expenses:filters")).toBeNull()
    view.unmount()
    render(table("expenses", true))
    await waitFor(() => expect(screen.getByTestId("entity-table").getAttribute("data-density")).toBe("compact"))
  })
  it("does not overwrite another list's preference during a list switch", async () => {
    localStorage.setItem("bills:density", "compact")
    localStorage.setItem("expenses:density", "comfortable")
    const view = render(table("bills"))
    await waitFor(() => expect(screen.getByTestId("entity-table").getAttribute("data-density")).toBe("compact"))
    view.rerender(table("expenses"))
    await waitFor(() => expect(screen.getByTestId("entity-table").getAttribute("data-density")).toBe("comfortable"))
    expect(localStorage.getItem("expenses:density")).toBe("comfortable")
    expect(localStorage.getItem("bills:density")).toBe("compact")
  })
})
