import { describe, expect, it } from "vitest"

import { labelsFromOptions, labelsFromRows } from "./entity-labels-context"

describe("labelsFromRows", () => {
  it("maps ids to names, falling back to the code, and skips rows with neither", () => {
    const labels = labelsFromRows([
      { id: 1n, name: " Acme " },
      { id: "2", code: "PLAN-B" },
      { id: 3, name: "" },
      { name: "No id" },
      { id: 5 },
    ])
    expect([...labels]).toEqual([
      ["1", "Acme"],
      ["2", "PLAN-B"],
    ])
  })

  it("is empty without rows", () => {
    expect(labelsFromRows(undefined).size).toBe(0)
  })
})

describe("labelsFromOptions", () => {
  it("skips disabled, blank and placeholder options", () => {
    const labels = labelsFromOptions([
      { value: "", label: "Select…" },
      { value: "1", label: "Acme" },
      { value: "2", label: "Gone", disabled: true },
      { value: "3", label: "  " },
    ])
    expect([...labels]).toEqual([["1", "Acme"]])
  })
})
