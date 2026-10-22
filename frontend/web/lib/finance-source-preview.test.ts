import assert from "node:assert/strict"
import test from "node:test"
import { financeSourceUrl, financeReceiptSourceUrl, linkedFinanceEvidence, linkedBillEvidence } from "./finance-source-preview"
const url = "/api/documents/blobs/object/7/eu/abcdef"
const row = { id: 3, organizationId: 7, companyId: 2, resModel: "account_move", resId: 9, employeeId: 4, url, mimetype: "image/png", name: "invoice.png" }
const scope = { organizationId: 7n, companyId: 2n, recordId: "9" }
test("preview URLs accept only the current organization's authenticated blob endpoint", () => {
  assert.equal(financeSourceUrl(url, 7n), url)
  for (const value of [url.replace('/7/', '/8/'), 'https://example.com/x.pdf', '//example.com/x', 'data:text/html,x', url+'?redirect=x', url+'/../x', 'javascript:alert(1)']) assert.equal(financeSourceUrl(value, 7n), null)
})
test("saved evidence requires the exact organization, company and record relation", () => {
  const candidates = [row, { ...row, id: 4, companyId: 8 }, { ...row, id: 5, organizationId: 8 }, { ...row, id: 6, resId: 10 }, { ...row, id: 7, isDeleted: true }, { ...row, id: 8, resModel: "sale_order" }]
  assert.deepEqual(linkedFinanceEvidence(candidates, scope).map((item) => item.id), ["3"])
  assert.deepEqual(linkedFinanceEvidence(candidates, { ...scope, companyId: 0n }), [])
})
test("receipts require the submitted ID relation and matching employee", () => {
  const candidates = [{ ...row, storageKey: "org-7/eu/abcdef", url: undefined }, { ...row, id: 4, employeeId: 5 }, { ...row, id: 5 }]
  assert.deepEqual(linkedFinanceEvidence(candidates, { ...scope, receiptIds: ["3", "4"], employeeId: "4" }).map((item) => item.id), ["3"])
  assert.deepEqual(linkedFinanceEvidence(candidates, { ...scope, receiptIds: [], employeeId: "4" }), [])
})

test("receipt object keys use the producer-owned URL mapping and reject foreign or arbitrary storage keys", () => {
  assert.equal(financeReceiptSourceUrl("org-7/eu/abcdef", 7n), url)
  for (const key of ["org-8/eu/abcdef", "receipt.pdf", "org-7/eu/../x", "https://example.com/x"]) assert.equal(financeReceiptSourceUrl(key, 7n), null)
  assert.equal(linkedFinanceEvidence([{ ...row, storageKey: "org-7/eu/abcdef" }], { ...scope, receiptIds: ["3"], employeeId: "4" })[0]?.url, url)
})

test("bill previews use one explicit current version belonging to the exact authorized document", () => {
  const version = { id: 10, documentId: 3, organizationId: 7, isCurrent: true, url, mimetype: "image/png", fileName: "source.png" }
  const doc = { ...row, url: undefined, mimetype: undefined }
  assert.equal(linkedBillEvidence([doc], [version], scope).files[0]?.url, url)
  assert.equal(linkedBillEvidence([doc], [{ ...version, documentId: 8 }], scope).unavailable, true)
  assert.equal(linkedBillEvidence([doc], [{ ...version, organizationId: 8 }], scope).unavailable, true)
  assert.equal(linkedBillEvidence([doc], [{ ...version, isCurrent: false }], scope).unavailable, true)
  assert.equal(linkedBillEvidence([doc], [version, { ...version, id: 11 }], scope).unavailable, true)
  assert.equal(linkedBillEvidence([doc], [version, { ...version, id: 999, isCurrent: false }], scope).files.length, 1)
})
