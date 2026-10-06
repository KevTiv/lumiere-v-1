import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityRow, EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

// Base UI's checkbox reads `PointerEvent`, which jsdom does not provide.
if (typeof globalThis.PointerEvent === "undefined") {
  Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
}

vi.mock("../components/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))

vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

afterEach(cleanup)

const baseConfig: EntityTableConfig = {
  mode: "table",
  rowKey: "id",
  searchable: true,
  searchKeys: ["name", "clientRef"],
  columns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name", sortable: true },
    { key: "total", label: "Total", sortable: true },
    { key: "state", label: "State" },
  ],
  filters: [{ key: "state", label: "State", options: [{ value: "Draft", label: "Draft" }] }],
}

const rows: EntityRow[] = [
  { id: 1, name: "Alpha 10", total: 30, state: { tag: "Draft" }, clientRef: "" },
  { id: 2, name: "Alpha 2", total: null, state: { tag: "Sale" }, clientRef: "PO-77" },
  { id: 3, name: "Beta", total: 5, state: { tag: "Draft" }, clientRef: "" },
]

function renderTable(overrides: Partial<EntityTableConfig> = {}, data: EntityRow[] = rows, props = {}) {
  return render(
    <RBACProvider>
      <EntityTable config={{ ...baseConfig, ...overrides }} data={data} {...props} />
    </RBACProvider>,
  )
}

/** Row ids in the order they are drawn. */
const drawnIds = () =>
  screen
    .getAllByTestId(/^entity-row-/)
    .map((row) => row.getAttribute("data-testid")!.replace("entity-row-", ""))

const header = (name: string) => screen.getByRole("button", { name })

describe("EntityTable sorting", () => {
  it("draws newest first until a column is chosen, with no column marked sorted", () => {
    renderTable()

    expect(drawnIds()).toEqual(["3", "2", "1"])
    expect(header("Name").getAttribute("aria-sort")).toBe("none")
  })

  it("sorts ascending on the first click, descending on the second", () => {
    renderTable()

    fireEvent.click(header("Name"))
    expect(header("Name").getAttribute("aria-sort")).toBe("ascending")
    expect(drawnIds()).toEqual(["2", "1", "3"])

    fireEvent.click(header("Name"))
    expect(header("Name").getAttribute("aria-sort")).toBe("descending")
    expect(drawnIds()).toEqual(["3", "1", "2"])
  })

  it("sorts numbers numerically and keeps an empty value last either way", () => {
    renderTable()

    fireEvent.click(header("Total"))
    expect(drawnIds()).toEqual(["3", "1", "2"])

    fireEvent.click(header("Total"))
    expect(drawnIds()).toEqual(["1", "3", "2"])
  })

  it("marks only the sorted column and moves the mark when another is chosen", () => {
    renderTable()

    fireEvent.click(header("Name"))
    fireEvent.click(header("Total"))

    expect(header("Name").getAttribute("aria-sort")).toBe("none")
    expect(header("Total").getAttribute("aria-sort")).toBe("ascending")
  })

  it("gives columns that are not sortable no sort button", () => {
    renderTable()

    expect(screen.queryByRole("button", { name: "State" })).toBeNull()
  })
})

describe("EntityTable search and filters", () => {
  it("searches the search keys, including one that is not a column", () => {
    renderTable()

    fireEvent.change(screen.getByRole("textbox", { name: "Search records" }), { target: { value: "po-77" } })

    expect(drawnIds()).toEqual(["2"])
  })

  it("applies a filter handed in from the URL and shows it as clearable when it has no control", () => {
    renderTable({ filters: [] }, rows, { initialFilters: { id: "3" } })

    expect(drawnIds()).toEqual(["3"])
    expect(screen.getByTestId("entity-active-filter-id")).toBeTruthy()
  })

  it("filters by an enum cell", () => {
    renderTable({}, rows, { initialFilters: { state: "draft" } })

    expect(drawnIds()).toEqual(["3", "1"])
  })

  it("says so when the filters hide every row, rather than that there are none", () => {
    renderTable({}, rows, { initialFilters: { state: "Cancel" } })

    expect(screen.getByText("No matching records")).toBeTruthy()
  })

  it("says there are no records when there is no data", () => {
    renderTable({}, [])

    expect(screen.getByText("No records yet")).toBeTruthy()
  })
})

describe("EntityTable paging", () => {
  const many: EntityRow[] = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    name: `Row ${index + 1}`,
    total: index,
    state: { tag: "Draft" },
    clientRef: "",
  }))

  it("shows 25 rows a page, newest first, and the range", () => {
    renderTable({}, many)

    expect(drawnIds()).toHaveLength(25)
    expect(drawnIds()[0]).toBe("60")
    expect(screen.getByText(/1-25 of 60/)).toBeTruthy()
  })

  it("moves to the next page and returns to the first when the search changes", () => {
    renderTable({}, many)

    fireEvent.click(screen.getByLabelText("Go to next page"))
    expect(drawnIds()[0]).toBe("35")

    fireEvent.change(screen.getByRole("textbox", { name: "Search records" }), { target: { value: "Row 5" } })
    expect(screen.queryByText(/26-50 of/)).toBeNull()
  })
})

describe("EntityTable selection on the engine", () => {
  const withAction: Partial<EntityTableConfig> = {
    actions: [{ id: "close", label: "Close", requiresSelection: true, onClick: vi.fn() }],
  }

  it("keeps the only selected row selected when its row is clicked, and unticks it with its checkbox", () => {
    renderTable(withAction)

    fireEvent.click(screen.getByTestId("entity-row-3"))
    fireEvent.click(screen.getByTestId("entity-row-3"))
    expect(screen.getByText("1 selected")).toBeTruthy()

    fireEvent.click(screen.getByTestId("entity-select-row-3"))
    expect(screen.queryByText("1 selected")).toBeNull()
  })

  it("selects the whole page from the header and counts it", () => {
    renderTable(withAction)

    fireEvent.click(screen.getByTestId("entity-select-all"))

    const bar = screen.getByTestId("entity-selection-actions")
    expect(within(bar).getByText("3 selected")).toBeTruthy()
  })
})
