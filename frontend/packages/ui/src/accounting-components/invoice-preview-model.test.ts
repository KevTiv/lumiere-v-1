import { describe, expect, it } from "vitest"
import { invoicePreviewModelFromMove } from "./invoice-preview-model"
import { invoiceTotals } from "./invoice-math"

describe("invoice previews", () => {
  it("recognizes vendor bills in the HTTP unit-variant encoding", () => {
    const model = invoicePreviewModelFromMove({ id: 1n, moveType: { inInvoice: [] }, amountTotal: 118, amountUntaxed: 100, amountTax: 18, amountResidual: 58 })
    expect(model.kind).toBe("bill")
    expect(model.amountDue).toBe(58)
    expect(model.totals).toMatchObject({ subtotal: 100, tax: 18, total: 118 })
  })

  it("previews discounts and multiple released tax kinds consistently", () => {
    const totals = invoiceTotals([
      { quantity: 2, unitPrice: 100, discount: 25, tax: { label: "VAT", amount: 18, amountType: "Percent" } },
      { quantity: 1, unitPrice: 80, discount: 0, tax: { label: "Included", amount: 20, amountType: "Division" } },
      { quantity: 3, unitPrice: 10, discount: 0, tax: { label: "Fee", amount: 5, amountType: "Fixed" } },
    ])
    expect(totals).toMatchObject({ subtotal: 260, tax: 52, total: 312 })
  })
})
