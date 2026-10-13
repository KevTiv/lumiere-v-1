import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./entity-table", () => ({
  EntityTable: (p: { data: Record<string, unknown>[]; onRowClick?: (row: Record<string, unknown>) => void }) => (
    <div data-testid="table">
      {p.data.map((row) => (
        <button key={String(row.id)} onClick={() => p.onRowClick?.(row)}>
          row-{String(row.id)}
        </button>
      ))}
    </div>
  ),
}))
vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ checkPermission: () => true }) }))

import { EntityView } from "./entity-view"
import { withReadOnlyStateBoard } from "../lib/entity-state-board"
import type { EntityViewConfig } from "../lib/entity-view-types"

const t = ((_key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _key) as never

const base: EntityViewConfig = {
  id: "toggle-test",
  title: "Tickets",
  view: {
    mode: "table",
    rowKey: "id",
    columns: [
      {
        key: "state",
        label: "State",
        type: "badge",
        badgeLabels: { New: "New", Closed: "Closed" },
      },
    ],
  },
}
const config = withReadOnlyStateBoard(t, base, { groupKey: "state", card: { titleKey: "name" } })
const data = [
  { id: 1, name: "Printer down", state: "New" },
  { id: 2, name: "Old issue", state: "Closed" },
]

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("EntityView table/board toggle", () => {
  it("switches to a read-only board, opens the record on card click and remembers the mode", () => {
    const onRowClick = vi.fn()
    const { unmount } = render(<EntityView config={config} data={data} onRowClick={onRowClick} />)
    expect(screen.getByTestId("table")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Board" }))
    expect(screen.queryByTestId("table")).toBeNull()
    expect(screen.getByTestId("entity-board-readonly")).toBeTruthy()

    fireEvent.click(screen.getByTestId("entity-board-card-1"))
    expect(onRowClick).toHaveBeenCalledWith(data[0])

    unmount()
    render(<EntityView config={config} data={data} onRowClick={onRowClick} />)
    expect(screen.getByTestId("entity-board-readonly")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Table" }))
    expect(screen.getByTestId("table")).toBeTruthy()
    expect(window.localStorage.getItem("lumiere:entity-view-mode:toggle-test")).toBe("table")
  })
})
