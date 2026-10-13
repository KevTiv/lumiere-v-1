import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const csv = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock("../lib/export-csv", async (orig) => ({
  ...(await orig<typeof import("../lib/export-csv")>()),
  downloadCsv: csv.download,
}))
vi.mock("./entity-table", () => ({ EntityTable: () => <div data-testid="table" /> }))
vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ checkPermission: () => true }) }))

import { EntityView, ListPivotSwitch, useScopedEntityTableConfig } from "./entity-view"
import { withReadOnlyStateBoard } from "../lib/entity-state-board"
import type { EntityTableConfig, EntityViewConfig } from "../lib/entity-view-types"
import { renderHook } from "@testing-library/react"

const t = ((key: string, o?: Record<string, unknown>) => {
  let text = (o?.defaultValue as string | undefined) ?? key
  for (const [k, v] of Object.entries(o ?? {})) text = text.replace(`{{${k}}}`, String(v))
  return text
}) as never

const table: EntityTableConfig = {
  mode: "table",
  rowKey: "id",
  searchable: true,
  searchKeys: ["reference"],
  filters: [
    {
      key: "kind",
      label: "Kind",
      type: "select",
      options: [
        { value: "A", label: "Kind A" },
        { value: "B", label: "Kind B" },
      ],
    },
    {
      key: "state",
      label: "State",
      type: "select",
      options: [
        { value: "Draft", label: "Draft" },
        { value: "Sale", label: "Confirmed" },
      ],
    },
  ],
  columns: [
    { key: "state", label: "State", type: "badge", badgeLabels: { Draft: "Draft", Sale: "Confirmed" } },
    { key: "amountTotal", label: "Total", type: "currency", currencyKey: "currencyCode" },
  ],
}
const config = withReadOnlyStateBoard(
  t,
  { id: "extras-test", title: "Orders", view: table } as EntityViewConfig,
  {
    groupKey: "state",
    card: { titleKey: "reference" },
    pivot: { groupKeys: ["state", "kind"], measureKeys: ["amountTotal"], currencyKey: "currencyCode" },
  },
)
const rows = [
  { id: 1, reference: "SO1", state: "Draft", kind: "A", amountTotal: 10, currencyCode: "EUR" },
  { id: 2, reference: "SO2", state: "Sale", kind: "B", amountTotal: 30, currencyCode: "EUR" },
  { id: 3, reference: "SO3", state: "Sale", kind: "A", amountTotal: 5, currencyCode: "EUR" },
]

beforeEach(() => {
  window.localStorage.clear()
  csv.download.mockClear()
})
afterEach(cleanup)

describe("board filters", () => {
  it("shows the table's select filters above the board and applies them to cards", () => {
    render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Board" }))
    expect(screen.getByTestId("entity-board-card-1")).toBeTruthy()
    fireEvent.change(screen.getByTestId("entity-board-filter-kind"), { target: { value: "B" } })
    expect(screen.queryByTestId("entity-board-card-1")).toBeNull()
    expect(screen.queryByTestId("entity-board-card-3")).toBeNull()
    expect(screen.getByTestId("entity-board-card-2")).toBeTruthy()
    fireEvent.change(screen.getByTestId("entity-board-filter-kind"), { target: { value: "__all__" } })
    expect(screen.getByTestId("entity-board-card-1")).toBeTruthy()
    expect(window.localStorage.getItem("lumiere:entity-view-mode:extras-test")).toBe("board")
  })
})

describe("currency formatting", () => {
  it("pivot totals use the single ISO currency of the rows", () => {
    render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    expect(within(screen.getByTestId("entity-pivot-total")).getByText("€45.00")).toBeTruthy()
  })

  it("falls back to USD for numeric ids and mixed currencies", () => {
    const withIds = rows.map((row) => ({ ...row, currencyCode: 7 }))
    render(<EntityView config={config} data={withIds} />)
    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    expect(within(screen.getByTestId("entity-pivot-total")).getByText("$45.00")).toBeTruthy()
  })

  it("table currency cells render with the row's code", () => {
    const { result } = renderHook(() => useScopedEntityTableConfig(table))
    const column = result.current.columns.find((c) => c.key === "amountTotal")!
    const cell = (row: Record<string, unknown>) => column.render!(row.amountTotal, row)
    expect(cell({ amountTotal: 10, currencyCode: "GBP" })).toBe("£10.00")
    expect(cell({ amountTotal: 10, currencyCode: 3 })).toBe("$10.00")
  })
})

describe("pivot columns by and CSV", () => {
  it("exports the pivot table as CSV", () => {
    render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    fireEvent.click(screen.getByTestId("entity-pivot-export"))
    expect(csv.download).toHaveBeenCalledTimes(1)
    const [name, text] = csv.download.mock.calls[0]!
    expect(name).toBe("pivot-state")
    expect(String(text).split("\r\n")).toEqual([
      "State,Count,Total",
      "Draft,1,10",
      "Confirmed,2,35",
      "Total,3,45",
    ])
  })

  it("remembers the columns-by choice in the mode's entry", () => {
    const { unmount } = render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    fireEvent.change(screen.getByTestId("entity-pivot-columns"), { target: { value: "kind" } })
    expect(JSON.parse(window.localStorage.getItem("lumiere:entity-view-mode:extras-test")!)).toEqual({
      mode: "pivot",
      columnKey: "kind",
    })
    unmount()
    render(<EntityView config={config} data={rows} />)
    expect((screen.getByTestId("entity-pivot-columns") as HTMLSelectElement).value).toBe("kind")
  })

  it("remembers it per list for custom list views too, and still reads plain mode entries", () => {
    window.localStorage.setItem("lumiere:entity-view-mode:list-x", "pivot")
    const pivot = config.view.mode === "table-or-board" ? config.view.pivot! : (undefined as never)
    const { unmount } = render(
      <ListPivotSwitch storageId="list-x" t={t} rows={rows} table={table} pivot={pivot}>
        <div />
      </ListPivotSwitch>,
    )
    fireEvent.change(screen.getByTestId("entity-pivot-columns"), { target: { value: "kind" } })
    unmount()
    render(
      <ListPivotSwitch storageId="list-x" t={t} rows={rows} table={table} pivot={pivot}>
        <div />
      </ListPivotSwitch>,
    )
    expect((screen.getByTestId("entity-pivot-columns") as HTMLSelectElement).value).toBe("kind")
  })
})
