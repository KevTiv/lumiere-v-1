import { describe, expect, it } from "vitest"

import {
  EMPTY_TABLE_VIEW,
  countRowsBy,
  groupRowsBy,
  readTableView,
  tableViewStorageKey,
  toggleHiddenColumn,
} from "./entity-table-view"

describe("entity table view state", () => {
  it("keys the view next to the list's filters", () => {
    expect(tableViewStorageKey("sales-orders")).toBe("sales-orders:view")
  })

  it("keeps only known columns and group keys", () => {
    expect(
      readTableView({ hiddenColumns: ["a", "gone", 3], groupBy: "status" }, ["a", "b"], ["status"]),
    ).toEqual({ hiddenColumns: ["a"], groupBy: "status" })
    expect(readTableView({ groupBy: "nope" }, ["a"], ["status"]).groupBy).toBeNull()
  })

  it("ignores junk and refuses to hide every column", () => {
    expect(readTableView(null, ["a"], [])).toBe(EMPTY_TABLE_VIEW)
    expect(readTableView({ hiddenColumns: ["a", "b"] }, ["a", "b"], []).hiddenColumns).toEqual([])
  })

  it("toggles columns but keeps one visible", () => {
    expect(toggleHiddenColumn([], "a", ["a", "b"])).toEqual(["a"])
    expect(toggleHiddenColumn(["a"], "a", ["a", "b"])).toEqual([])
    expect(toggleHiddenColumn(["a"], "b", ["a", "b"])).toEqual(["a"])
  })

  it("groups by first appearance and counts every row", () => {
    const rows = [{ s: "x" }, { s: "y" }, { s: "x" }, { s: null }]
    const groups = groupRowsBy(
      rows.map((original) => ({ original })),
      "s",
    )
    expect(groups.map((g) => [g.value, g.rows.length])).toEqual([
      ["x", 2],
      ["y", 1],
      ["", 1],
    ])
    expect(countRowsBy(rows, "s").get("x")).toBe(2)
  })
})

import {
  MAX_SAVED_FILTERS,
  activeFilterEntries,
  readSavedFilters,
  removeSavedFilter,
  savedFiltersStorageKey,
  upsertSavedFilter,
} from "./entity-table-view"

describe("saved table filters", () => {
  const allowed = new Set(["status", "owner"])

  it("keys them next to the view state", () => {
    expect(savedFiltersStorageKey("orders")).toBe("orders:saved-filters")
  })

  it("keeps well-formed entries and drops unknown filter keys", () => {
    const read = readSavedFilters(
      [
        { name: "Open", search: "acme", filters: { status: "open", gone: "x", owner: 3 } },
        { name: "Open", filters: {} },
        { name: "  ", filters: {} },
        "junk",
      ],
      allowed,
    )
    expect(read).toEqual([{ name: "Open", search: "acme", filters: { status: "open" } }])
    expect(readSavedFilters({}, allowed)).toEqual([])
  })

  it("ignores 'all' filters and refuses to save an empty set", () => {
    expect(activeFilterEntries({ status: "__all__", owner: "me", x: "" })).toEqual({ owner: "me" })
    expect(upsertSavedFilter([], { name: "Nothing", search: " ", filters: { status: "__all__" } })).toEqual([])
    expect(upsertSavedFilter([], { name: " ", search: "x", filters: {} })).toEqual([])
  })

  it("replaces a saved filter of the same name and removes by name", () => {
    const first = upsertSavedFilter([], { name: "Mine", search: "", filters: { owner: "me" } })
    const second = upsertSavedFilter(first, { name: "mine", search: "", filters: { owner: "you" } })
    expect(second).toEqual([{ name: "mine", search: "", filters: { owner: "you" } }])
    expect(removeSavedFilter(second, "mine")).toEqual([])
  })

  it("caps the list, dropping the oldest", () => {
    let saved: ReturnType<typeof upsertSavedFilter> = []
    for (let i = 0; i < MAX_SAVED_FILTERS + 3; i++) {
      saved = upsertSavedFilter(saved, { name: `f${i}`, search: "", filters: { status: String(i) } })
    }
    expect(saved).toHaveLength(MAX_SAVED_FILTERS)
    expect(saved[0]?.name).toBe("f3")
  })
})
