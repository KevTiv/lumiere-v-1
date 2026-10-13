import { describe, expect, it } from "vitest"

import { lineAmounts, orderTotals, roundMoney } from "./sale-order-line-totals"

const line = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  productUomQty: 2,
  priceUnit: 50,
  discount: 0,
  priceSubtotal: 100,
  priceTax: 20,
  ...overrides,
})

describe("lineAmounts", () => {
  it("uses the saved amounts when nothing is edited", () => {
    expect(lineAmounts(line())).toEqual({ subtotal: 100, tax: 20, total: 120 })
    expect(lineAmounts(line(), {})).toEqual({ subtotal: 100, tax: 20, total: 120 })
  })

  it("reads snake_case projections too", () => {
    expect(lineAmounts({ price_subtotal: 10, price_tax: 1 })).toEqual({ subtotal: 10, tax: 1, total: 11 })
  })

  it("reprices from the edited quantity, price and discount", () => {
    expect(lineAmounts(line(), { quantity: 3 }).subtotal).toBe(150)
    expect(lineAmounts(line(), { priceUnit: 60 }).subtotal).toBe(120)
    expect(lineAmounts(line(), { discount: 10 }).subtotal).toBe(90)
    expect(lineAmounts(line(), { quantity: 4, priceUnit: 25, discount: 50 }).subtotal).toBe(50)
  })

  it("keeps the line's own tax rate on an edit", () => {
    expect(lineAmounts(line(), { quantity: 3 })).toEqual({ subtotal: 150, tax: 30, total: 180 })
  })

  it("assumes no tax for a line with no saved subtotal, since its rate is unknown", () => {
    expect(lineAmounts(line({ priceSubtotal: 0, priceTax: 0 }), { quantity: 3 })).toEqual({
      subtotal: 150,
      tax: 0,
      total: 150,
    })
  })

  it("rounds to cents", () => {
    expect(lineAmounts(line(), { priceUnit: 33.333 }).subtotal).toBe(66.67)
    expect(roundMoney(1.005)).toBe(1.01)
  })
})

describe("orderTotals", () => {
  const lines = [line({ id: 1 }), line({ id: 2, priceSubtotal: 50, priceTax: 0 })]

  it("sums the saved lines and is not an estimate", () => {
    expect(orderTotals(lines)).toEqual({ subtotal: 150, tax: 20, total: 170, estimated: false })
  })

  it("includes unsaved edits, by line id, and marks the result as an estimate", () => {
    expect(orderTotals(lines, { "1": { quantity: 3 } })).toEqual({
      subtotal: 200,
      tax: 30,
      total: 230,
      estimated: true,
    })
  })

  it("is zero for no lines", () => {
    expect(orderTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0, estimated: false })
  })
})
