import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { EntityRow } from "../lib/entity-view-types"
import { compareCellValues, matchesSearch, rowFilterValue } from "../lib/entity-table-engine"
import { useEntityTable, type UseEntityTableOptions } from "./use-entity-table"

afterEach(cleanup)

const columns = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "state", label: "State" },
  { key: "total", label: "Total" },
]

const rows: EntityRow[] = [
  { id: 1, name: "Alpha 2", state: { tag: "Draft" }, total: 30 },
  { id: 2, name: "Alpha 10", state: { tag: "Sale" }, total: null },
  { id: 3, name: "beta", state: { tag: "Sale" }, total: 5 },
  { id: 4, name: "Gamma", state: { tag: "Draft" }, total: 12 },
]

function setup(overrides: Partial<UseEntityTableOptions> = {}) {
  return renderHook((props: UseEntityTableOptions) => useEntityTable(props), {
    initialProps: {
      columns,
      data: rows,
      rowKey: "id",
      pageSize: 25,
      search: "",
      filters: {},
      ...overrides,
    },
  })
}

const ids = (hook: { current: ReturnType<typeof useEntityTable> }) =>
  hook.current.sortedRows.map((row) => row.id)

describe("compareCellValues", () => {
  it("orders numbers numerically, text naturally, and dates by time", () => {
    expect(compareCellValues(2, 10)).toBeLessThan(0)
    expect(compareCellValues("Alpha 2", "Alpha 10")).toBeLessThan(0)
    expect(compareCellValues("2024-01-02T00:00:00Z", "2024-01-10T00:00:00Z")).toBeLessThan(0)
  })
})

describe("matching helpers", () => {
  it("reads enum and option cells as text for filtering", () => {
    expect(rowFilterValue({ s: { tag: "Sale" } }, "s")).toBe("Sale")
    expect(rowFilterValue({ s: { some: { tag: "Sale" } } }, "s")).toBe("Sale")
    expect(rowFilterValue({ s: null }, "s")).toBe("")
  })

  it("searches the given keys case-insensitively and matches everything for an empty query", () => {
    expect(matchesSearch({ a: "Hello", b: "x" }, ["a"], "ELL")).toBe(true)
    expect(matchesSearch({ a: "Hello", b: "ell" }, ["a"], "zzz")).toBe(false)
    expect(matchesSearch({ a: "Hello" }, ["a"], "")).toBe(true)
  })
})

describe("useEntityTable sorting", () => {
  it("lists newest first when no column is chosen", () => {
    const { result } = setup()

    expect(ids(result)).toEqual([4, 3, 2, 1])
    expect(result.current.sortedBy).toBeUndefined()
  })

  it("sorts ascending on the first click, then toggles descending and back", () => {
    const { result } = setup()

    act(() => void result.current.toggleSort("name"))
    expect(result.current.sortedBy).toEqual({ id: "name", desc: false })
    expect(ids(result)).toEqual([1, 2, 3, 4])

    act(() => void result.current.toggleSort("name"))
    expect(result.current.sortedBy).toEqual({ id: "name", desc: true })
    expect(ids(result)).toEqual([4, 3, 2, 1])

    act(() => void result.current.toggleSort("name"))
    expect(result.current.sortedBy).toEqual({ id: "name", desc: false })
  })

  it("sorts the row key ascending on its first click even though it drives the default order", () => {
    const { result } = setup()

    act(() => void result.current.toggleSort("id"))

    expect(result.current.sortedBy).toEqual({ id: "id", desc: false })
    expect(ids(result)).toEqual([1, 2, 3, 4])
  })

  it("sorts numbers numerically and keeps empty values last in both directions", () => {
    const { result } = setup()

    act(() => void result.current.toggleSort("total"))
    expect(ids(result)).toEqual([3, 4, 1, 2])

    act(() => void result.current.toggleSort("total"))
    expect(ids(result)).toEqual([1, 4, 3, 2])
  })

  it("orders embedded numbers naturally", () => {
    const { result } = setup({ data: rows.filter((row) => String(row.name).startsWith("Alpha")) })

    act(() => void result.current.toggleSort("name"))

    expect(result.current.sortedRows.map((row) => row.name)).toEqual(["Alpha 2", "Alpha 10"])
  })
})

describe("useEntityTable filtering", () => {
  it("filters by a column value, ignoring case and unwrapping enum cells", () => {
    const { result } = setup({ filters: { state: "sale" } })

    expect(ids(result)).toEqual([3, 2])
  })

  it("treats __all__ and empty values as no filter", () => {
    const { result } = setup({ filters: { state: "__all__", name: "" } })

    expect(ids(result)).toEqual([4, 3, 2, 1])
  })

  it("filters by a key that has no visible column, such as an id from a record link", () => {
    const { result } = setup({ columns: columns.filter((column) => column.key !== "id"), filters: { id: "3" } })

    expect(ids(result)).toEqual([3])
  })

  it("combines several filters", () => {
    const { result } = setup({ filters: { state: "Sale", name: "beta" } })

    expect(ids(result)).toEqual([3])
  })

  it("searches the search keys, including ones that are not columns", () => {
    const withRef = rows.map((row) => ({ ...row, clientRef: row.id === 4 ? "PO-99" : "" }))
    const { result } = setup({ data: withRef, searchKeys: ["name", "clientRef"], search: "po-99" })

    expect(ids(result)).toEqual([4])
  })

  it("does not search when the table has no search keys", () => {
    const { result } = setup({ search: "zzz" })

    expect(ids(result)).toHaveLength(4)
  })
})

describe("useEntityTable paging", () => {
  const many: EntityRow[] = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: `n${index}`, state: { tag: "Draft" }, total: index }))

  it("slices pages and reports the position", () => {
    const { result } = setup({ data: many, pageSize: 2 })

    expect(result.current.pageCount).toBe(3)
    expect(result.current.currentPage).toBe(1)
    expect(result.current.pageRows.map((row) => row.original.id)).toEqual([5, 4])

    act(() => result.current.setPage(3))
    expect(result.current.currentPage).toBe(3)
    expect(result.current.pageRows.map((row) => row.original.id)).toEqual([1])
  })

  it("returns to the first page when the filters change", () => {
    const { result, rerender } = setup({ data: many, pageSize: 2 })
    act(() => result.current.setPage(3))

    rerender({ columns, data: many, rowKey: "id", pageSize: 2, search: "", filters: { state: "Draft" } })

    expect(result.current.currentPage).toBe(1)
  })

  it("returns to the first page when the sort changes", () => {
    const { result } = setup({ data: many, pageSize: 2 })
    act(() => result.current.setPage(2))

    act(() => void result.current.toggleSort("name"))

    expect(result.current.currentPage).toBe(1)
  })

  it("exports everything that passes the filters, not just the page", () => {
    const { result } = setup({ data: many, pageSize: 2 })

    expect(result.current.sortedRows).toHaveLength(5)
    expect(result.current.pageRows).toHaveLength(2)
  })
})

describe("useEntityTable selection", () => {
  it("selects rows by their key and reports them", () => {
    const { result } = setup()

    act(() => result.current.table.getRow("2").toggleSelected(true))
    act(() => result.current.table.getRow("3").toggleSelected(true))

    expect(result.current.selectedRows.map((row) => row.id).sort()).toEqual([2, 3])
    expect(result.current.selectedCount).toBe(2)
  })

  it("leaves out selected rows the current filters hide", () => {
    const { result, rerender } = setup()
    act(() => result.current.table.getRow("1").toggleSelected(true))
    act(() => result.current.table.getRow("3").toggleSelected(true))

    rerender({ columns, data: rows, rowKey: "id", pageSize: 25, search: "", filters: { state: "Sale" } })

    expect(result.current.selectedRows.map((row) => row.id)).toEqual([3])
  })

  it("selects and clears a whole page", () => {
    const { result } = setup({ pageSize: 2 })

    act(() => result.current.table.toggleAllPageRowsSelected(true))
    expect(result.current.selectedRows.map((row) => row.id).sort()).toEqual([3, 4])
    expect(result.current.table.getIsAllPageRowsSelected()).toBe(true)

    act(() => result.current.clearSelection())
    expect(result.current.selectedCount).toBe(0)
  })
})
