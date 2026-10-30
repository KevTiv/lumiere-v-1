import assert from "node:assert/strict"
import test from "node:test"
import { approvalSourceResource, approvalSourceSummary, approvalRequestedEffect } from "./approval-source-summary"

const source = { id: "9007199254740993", organizationId: 7, companyId: 9, name: "BILL/42", invoicePartnerDisplayName: "Supplier", amountTotal: "1234.567", currencyId: "3" }

test("approval summaries require one exact authorized scoped record and preserve large identity", () => {
  assert.deepEqual(approvalSourceSummary([source], source.id, 7, 9, [{ id: "3", code: "KWD" }], "en"), { reference: "BILL/42", party: "Supplier", money: "KWD 1,234.567" })
  assert.equal(approvalSourceSummary([source], "9007199254740992", 7, 9, [], "en"), null)
  assert.equal(approvalSourceSummary([source], source.id, 7, 10, [], "en"), null)
  assert.equal(approvalSourceSummary([source, source], source.id, 7, 9, [], "en"), null)
})

test("redacted amounts, missing currencies and unsupported source fields remain unavailable", () => {
  assert.deepEqual(approvalSourceSummary([{ id: "1", organizationId: 7, companyId: 9 }], "1", 7, 9, [], "en"), { reference: undefined, party: undefined, money: undefined })
  assert.equal(approvalSourceSummary([source], source.id, 7, 9, [], "en")?.money, undefined)
  assert.equal(approvalSourceSummary([{ ...source, amountTotal: "" }], source.id, 7, 9, [{ id: "3", code: "USD" }], "en")?.money, undefined)
  assert.equal(approvalSourceResource("private_internal_model"), null)
  assert.equal(approvalRequestedEffect({ id: 1, guardedAction: { key: "PostAccountMove" } }), "Post the accounting document")
  assert.equal(approvalRequestedEffect({ id: 1, guardedAction: { key: 3 } }), null)
})
