import { describe, expect, it } from "vitest"
import { buildPivot, pivotMeasureValue } from "./entity-pivot"

const rows = [
  { id: 1, state: "Draft", kind: "A", amount: 10, residual: 1, currencyId: "USD" },
  { id: 2, state: "Sale", kind: "A", amount: 20.5, residual: 0, currencyId: "USD" },
  { id: 3, state: { tag: "Sale" }, kind: "B", amount: "5", residual: null, currencyId: "USD" },
  { id: 4, kind: "B", amount: "n/a", residual: 2, currencyId: "USD" },
]

describe("buildPivot", () => {
  it("counts and sums per group, with a grand total and group order from the preferred list", () => {
    const result = buildPivot({
      rows,
      rowKey: "state",
      measureKeys: ["amount", "residual"],
      orderFor: () => ["Sale", "Draft"],
      labelFor: (_k, v) => (v === "" ? "None" : v),
    })
    expect(result.rows.map((r) => [r.value, r.total.count, r.total.sums])).toEqual([
      ["Sale", 2, [25.5, 0]],
      ["Draft", 1, [10, 1]],
      ["", 1, [0, 2]],
    ])
    expect(result.rows[2]!.label).toBe("None")
    expect(result.total).toEqual({ count: 4, sums: [35.5, 3] })
    expect(result.columns).toEqual([])
  })

  it("adds a second grouping as columns with column totals", () => {
    const result = buildPivot({ rows, rowKey: "state", columnKey: "kind", measureKeys: ["amount"] })
    expect(result.columns.map((c) => c.value)).toEqual(["A", "B"])
    const sale = result.rows.find((r) => r.value === "Sale")!
    expect(sale.cells.A).toEqual({ count: 1, sums: [20.5] })
    expect(sale.cells.B).toEqual({ count: 1, sums: [5] })
    expect(result.columnTotals.A).toEqual({ count: 2, sums: [30.5] })
    expect(result.columnTotals.B).toEqual({ count: 2, sums: [5] })
  })

  it("reports currencies and flags a mix", () => {
    const one = buildPivot({ rows, rowKey: "state", measureKeys: ["amount"], currencyKey: "currencyId" })
    expect(one.currencies).toEqual(["USD"])
    expect(one.mixedCurrencies).toBe(false)
    const mixed = buildPivot({
      rows: [...rows, { id: 5, state: "Sale", amount: 1, currencyId: "EUR" }],
      rowKey: "state",
      measureKeys: ["amount"],
      currencyKey: "currencyId",
    })
    expect(mixed.currencies).toEqual(["EUR", "USD"])
    expect(mixed.mixedCurrencies).toBe(true)
  })

  it("has no currencies when the rows carry no currency field", () => {
    const result = buildPivot({ rows: [{ state: "A", amount: 1 }], rowKey: "state", measureKeys: ["amount"], currencyKey: "currencyId" })
    expect(result.currencies).toEqual([])
    expect(result.mixedCurrencies).toBe(false)
  })

  it("handles empty input and bigint measures", () => {
    const empty = buildPivot({ rows: [], rowKey: "state", measureKeys: ["amount"] })
    expect(empty.rows).toEqual([])
    expect(empty.total).toEqual({ count: 0, sums: [0] })
    expect(pivotMeasureValue({ amount: 5n }, "amount")).toBe(5)
    expect(pivotMeasureValue({ amount: NaN }, "amount")).toBeNull()
  })
})
