import { describe, expect, it } from "vitest"

import { parseModuleFilters, removeModuleFilterFromQuery } from "./module-url-filters"

describe("parseModuleFilters", () => {
  it("parses key:value entries, keeping colons in values", () => {
    expect(parseModuleFilters(["id:11", "state:New", "at:10:30"])).toEqual({
      id: "11",
      state: "New",
      at: "10:30",
    })
  })

  it("skips malformed and empty entries; later duplicates win", () => {
    expect(parseModuleFilters(["nocolon", ":x", "k:", "id:1", "id:2"])).toEqual({ id: "2" })
  })
})

describe("removeModuleFilterFromQuery", () => {
  it("removes every matching filter while preserving the tab, unrelated params, and other filters", () => {
    const query = [
      "tab=orders",
      "filter=id%3A2",
      "filter=status%3Adraft",
      "view=compact",
      "filter=id%3A3",
    ].join("&")

    expect(removeModuleFilterFromQuery(query, "id")).toBe(
      "tab=orders&view=compact&filter=status%3Adraft",
    )
  })

  it("keeps every query entry when the requested filter is absent", () => {
    const query = "tab=orders&filter=status%3Adraft&view=compact"
    const result = new URLSearchParams(removeModuleFilterFromQuery(query, "id"))

    expect([...result.entries()]).toHaveLength(3)
    expect(result.get("tab")).toBe("orders")
    expect(result.getAll("filter")).toEqual(["status:draft"])
    expect(result.get("view")).toBe("compact")
  })
})
