import { describe, expect, it } from "vitest"
import { CSV_IMPORT_CONTRACTS } from "./csv-import-columns"

describe("CSV_IMPORT_CONTRACTS", () => {
  const entries = Object.entries(CSV_IMPORT_CONTRACTS)

  it("declares required headers and a permission resource for every kind", () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const [kind, contract] of entries) {
      expect(contract.required.length, `${kind} required`).toBeGreaterThan(0)
      expect(contract.resource, `${kind} resource`).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it("uses lower-case headers with no duplicates between required and optional", () => {
    for (const [kind, contract] of entries) {
      const all: string[] = [...contract.required, ...contract.optional]
      expect(new Set(all).size, `${kind} duplicates`).toBe(all.length)
      for (const header of all) expect(header, kind).toBe(header.toLowerCase())
    }
  })
})
