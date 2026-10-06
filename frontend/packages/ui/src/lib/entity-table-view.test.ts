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
