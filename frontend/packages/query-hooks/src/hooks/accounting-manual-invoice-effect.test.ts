import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { decodeManualAccountInvoiceEffect } from "./accounting/moves"

describe("decodeManualAccountInvoiceEffect", () => {
  it("accepts only the exact account move record reference", () => {
    assert.deepEqual(
      decodeManualAccountInvoiceEffect({
        data: {
          resource: "account-moves",
          id: "42",
          href: "/accounting/invoices/42",
        },
      }),
      {
        resource: "account-moves",
        id: "42",
        href: "/accounting/invoices/42",
      },
    )
    assert.equal(decodeManualAccountInvoiceEffect({ data: null }), null)
  })

  it("fails closed for a different resource or inferred navigation target", () => {
    assert.throws(() =>
      decodeManualAccountInvoiceEffect({
        data: { resource: "contacts", id: "42", href: "/accounting/invoices/42" },
      }),
    )
    assert.throws(() =>
      decodeManualAccountInvoiceEffect({
        data: { resource: "account-moves", id: "42", href: "/accounting/invoices/41" },
      }),
    )
  })
})
