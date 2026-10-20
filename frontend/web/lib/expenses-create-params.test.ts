import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  expenseQuantity,
  newExpenseClientRequestId,
  parseAttachmentIds,
  toCreateExpenseParams,
} from "./expenses-create-params"

describe("expense operator create params", () => {
  it("preserves the receipt identity and retry identity on create", () => {
    const params = toCreateExpenseParams(
      {
        employeeId: "7",
        name: "Hotel",
        date: "2026-10-13",
        totalAmount: "73.17",
        quantity: "1",
        clientRequestId: "expense-fixed-retry-key",
      },
      { currencyId: "2", pricelistId: "4" },
      [31n],
    )

    assert.ok(params)
    assert.deepEqual(params.attachmentIds, [31n])
    assert.equal(params.clientRequestId, "expense-fixed-retry-key")
    assert.equal(params.employeeId, 7n)
    assert.equal(params.currencyId, 2n)
  })

  it("treats an untouched quantity input as one unit", () => {
    const params = toCreateExpenseParams(
      { employeeId: "7", name: "Taxi", date: "2026-10-13", totalAmount: "12", quantity: "" },
      { currencyId: "2", pricelistId: "4" },
    )
    assert.equal(params?.quantity, 1)
    assert.equal(expenseQuantity(undefined), 1)
    assert.equal(expenseQuantity("3"), 3)
  })

  it("generates non-empty command identities and rejects invalid attachment ids", () => {
    const first = newExpenseClientRequestId()
    const second = newExpenseClientRequestId()
    assert.match(first, /^expense-/)
    assert.notEqual(first, second)
    assert.deepEqual(parseAttachmentIds({ attachmentIds: "31, nope, 0, 32" }), [31n, 32n])
  })
})
