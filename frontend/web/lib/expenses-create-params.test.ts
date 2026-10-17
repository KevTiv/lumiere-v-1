import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  newExpenseClientRequestId,
  parseAttachmentIds,
  toCreateExpenseParams,
} from "./expenses-create-params"

describe("expense operator create params", () => {
  it("defaults an untouched or cleared optional quantity to one", () => {
    for (const quantity of [undefined, null, "", "   "]) {
      const params = toCreateExpenseParams({
        employeeId: "7", name: "Hotel", date: "2026-10-13",
        totalAmount: "73.17", quantity,
      }, "2")
      assert.ok(params)
      assert.equal(params.quantity, 1)
      assert.equal(params.unitAmount, 73.17)
    }
  })

  it("preserves an explicit quantity, including zero for backend rejection", () => {
    for (const quantity of [0, "0", "2.5"]) {
      const params = toCreateExpenseParams({
        employeeId: "7", name: "Hotel", date: "2026-10-13",
        totalAmount: "73.17", quantity,
      }, "2")
      assert.equal(params?.quantity, Number(quantity))
    }
  })

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

  it("generates non-empty command identities and rejects invalid attachment ids", () => {
    const first = newExpenseClientRequestId()
    const second = newExpenseClientRequestId()
    assert.match(first, /^expense-/)
    assert.notEqual(first, second)
    assert.deepEqual(parseAttachmentIds({ attachmentIds: "31, nope, 0, 32" }), [31n, 32n])
  })
})
