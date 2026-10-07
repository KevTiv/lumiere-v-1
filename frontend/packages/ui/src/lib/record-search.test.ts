import { describe, expect, it } from "vitest"
import {
  isRecordSearchQuery,
  normalizeSearchText,
  readRowField,
  scoreSearchMatch,
  searchRecords,
} from "./record-search"

describe("record search", () => {
  it("normalizes case, accents and spaces", () => {
    expect(normalizeSearchText("  Élodie   DÉJÀ ")).toBe("elodie deja")
    expect(normalizeSearchText(null)).toBe("")
  })

  it("ranks exact above prefix above substring", () => {
    expect(scoreSearchMatch("so001", "SO001")).toBe(3)
    expect(scoreSearchMatch("so0", "SO001")).toBe(2)
    expect(scoreSearchMatch("001", "SO001")).toBe(1)
    expect(scoreSearchMatch("zzz", "SO001")).toBe(0)
    expect(scoreSearchMatch("cafe", "Café Noir")).toBe(2)
  })

  it("reads snake_case fallbacks", () => {
    expect(readRowField({ partner_id: 4 }, "partnerId")).toBe(4)
    expect(readRowField({ partnerId: 5, partner_id: 4 }, "partnerId")).toBe(5)
  })

  it("returns the best rows first, capped, with stable ties", () => {
    const rows = [
      { id: 1, n: "xx acme" },
      { id: 2, n: "acme" },
      { id: 3, n: "acme two" },
      { id: 4, n: "acme three" },
      { id: 5, n: "other" },
    ]
    const hits = searchRecords(rows, "ACME", (r) => [r.n], 3)
    expect(hits.map((h) => h.row.id)).toEqual([2, 3, 4])
    expect(searchRecords(rows, "", (r) => [r.n])).toEqual([])
    expect(searchRecords(null, "acme", (r: { n: string }) => [r.n])).toEqual([])
  })

  it("takes the best score over several fields", () => {
    const hits = searchRecords([{ a: "zzz", b: "Bob" }], "bob", (r) => [r.a, r.b])
    expect(hits[0]?.score).toBe(3)
  })

  it("requires two characters", () => {
    expect(isRecordSearchQuery("a")).toBe(false)
    expect(isRecordSearchQuery(" a ")).toBe(false)
    expect(isRecordSearchQuery("ab")).toBe(true)
  })
})
