import { describe, expect, it } from "vitest"

import { parseModuleFilters } from "./module-url-filters"

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
