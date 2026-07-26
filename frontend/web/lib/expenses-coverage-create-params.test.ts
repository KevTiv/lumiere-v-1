import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  toCreateExpenseAdvanceParams,
  toCreateExpenseProjectRebillParams,
  toCreateExpenseReimbursementParams,
} from "./expenses-coverage-create-params"

const baseAdvance = {
  employeeId: 10n,
  name: "Travel advance",
  currencyId: 1n,
  amount: 100,
  journalId: 2n,
  cashAccountId: 3n,
  advanceAccountId: 4n,
}

describe("expenses coverage create params — fail-closed FKs", () => {
  it("returns null when journal or accounts are missing on advance", () => {
    assert.equal(toCreateExpenseAdvanceParams({ ...baseAdvance, journalId: undefined }), null)
    assert.equal(toCreateExpenseAdvanceParams({ ...baseAdvance, cashAccountId: "" }), null)
    assert.equal(toCreateExpenseAdvanceParams({ ...baseAdvance, advanceAccountId: null }), null)
  })

  it("returns null when journal or accounts are magic 0n on advance", () => {
    assert.equal(toCreateExpenseAdvanceParams({ ...baseAdvance, journalId: 0n }), null)
    assert.equal(toCreateExpenseAdvanceParams({ ...baseAdvance, cashAccountId: 0 }), null)
    assert.equal(toCreateExpenseAdvanceParams({ ...baseAdvance, advanceAccountId: "0" }), null)
  })

  it("maps advance when required FKs are present", () => {
    const params = toCreateExpenseAdvanceParams(baseAdvance)
    assert.ok(params)
    assert.equal(params.journalId, 2n)
    assert.equal(params.cashAccountId, 3n)
    assert.equal(params.advanceAccountId, 4n)
    assert.notEqual(params.journalId, 0n)
  })

  it("returns null when reimbursement journal/accounts missing or zero", () => {
    assert.equal(
      toCreateExpenseReimbursementParams({
        journalId: 5n,
        liquidityAccountId: 6n,
      }),
      null,
    )
    assert.equal(
      toCreateExpenseReimbursementParams({
        journalId: 0n,
        liquidityAccountId: 6n,
        payableAccountId: 7n,
      }),
      null,
    )
    const ok = toCreateExpenseReimbursementParams({
      journalId: 5n,
      liquidityAccountId: 6n,
      payableAccountId: 7n,
      amount: 50,
    })
    assert.ok(ok)
    assert.equal(ok.payableAccountId, 7n)
  })

  it("returns null when project rebill accounts missing", () => {
    assert.equal(
      toCreateExpenseProjectRebillParams({
        journalId: 8n,
        receivableAccountId: 9n,
      }),
      null,
    )
    assert.equal(
      toCreateExpenseProjectRebillParams({
        journalId: 8n,
        receivableAccountId: 0n,
        incomeAccountId: 10n,
      }),
      null,
    )
  })
})
