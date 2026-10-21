import { describe, expect, it } from "vitest"
import { accountingImportReview } from "./accounting-import-review"

describe("accounting source control totals", () => {
  it("reviews every source row and keeps currencies separate", () => {
    const review = accountingImportReview("ref_,currency_id,debit,credit\nA,1,10,0\nA,1,0,10\nB,1,20,0\nB,1,0,20\nC,2,30,0\nC,2,0,30\n", "account_move_line")!
    expect(review.rowCount).toBe(6)
    expect(review.referenceCount).toBe(3)
    expect(review.totals).toEqual([
      { currency: "1", documentType: "", field: "debit", amount: "30" },
      { currency: "1", documentType: "", field: "credit", amount: "30" },
      { currency: "2", documentType: "", field: "debit", amount: "30" },
      { currency: "2", documentType: "", field: "credit", amount: "30" },
    ])
  })

  it("separates historical supplier balances from receivables", () => {
    const review = accountingImportReview("document_type,reference,source_total,opening_residual\nout_invoice,I-1,1200,200\nin_invoice,B-1,500,100\n", "account_move_line")!
    expect(review.issues).toEqual([])
    expect(review.totals).toContainEqual({ currency: "", documentType: "out_invoice", field: "opening_residual", amount: "200" })
    expect(review.totals).toContainEqual({ currency: "", documentType: "in_invoice", field: "opening_residual", amount: "100" })
  })

  it("does not silently drop an invalid amount outside the grid preview", () => {
    const review = accountingImportReview("debit,credit\n1,0\n0,1\n2,0\n0,2\n3,0\n0,wat\n", "account_move_line")!
    expect(review.issues).toEqual([expect.objectContaining({ rowNumber: 7, message: expect.stringContaining("credit") })])
  })

  it("blocks duplicate headers and outstanding document references", () => {
    const review = accountingImportReview("document_type,reference,source_total,opening_residual,opening_residual\nin_invoice,A,100,20,20\nin_invoice,A,100,200,200\n", "account_move_line")!
    expect(review.issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining("Duplicate column"),
      expect.stringContaining("duplicate document reference"),
      expect.stringContaining("exceeds the source total"),
    ])
  })

  it("does not invent money totals for tax rates or nonfinancial imports", () => {
    expect(accountingImportReview("name,amount\nVAT,18\n", "account_tax")).toBeNull()
    expect(accountingImportReview("name\nAda\n", "hr_employee")).toBeNull()
  })

  it("sums decimal source digits exactly and leaves blank currency unresolved", () => {
    const review = accountingImportReview("currency_id,debit,credit\n,0.1,0\n,0.2,0.3\n7,10,10\n", "account_move_line")!
    expect(review.issues).toEqual([])
    expect(review.totals).toContainEqual({ currency: "", documentType: "", field: "debit", amount: "0.3" })
    expect(review.totals).toContainEqual({ currency: "7", documentType: "", field: "debit", amount: "10" })
  })

  it("blocks unsupported precision and unsafe source or aggregate magnitude", () => {
    const review = accountingImportReview("debit,credit\n0.0000000000001,0\n9007199254740992,0\n9007199254740991,0\n1,0\n", "account_move_line")!
    expect(review.issues).toHaveLength(3)
    expect(review.totals.find((total) => total.field === "debit")?.amount).toBe("9007199254740991")
  })
})
