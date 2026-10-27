import assert from "node:assert/strict"
import test from "node:test"
import { messageRecordChoices, resolveMessageRecordChoice, type MessageRecordLabels } from "./message-record-choice"
const labels: MessageRecordLabels = { invoice: "Invoice", bill: "Vendor bill", creditNote: "Credit note", vendorCredit: "Vendor credit", journalEntry: "Journal entry", accountingDocument: "Accounting document", contact: "Contact" }
const scope = { organizationId: "7", companyId: "11" }
const large = "9007199254740993"
const next = "9007199254740994"
const moves = [
  { id: large, organizationId: "7", companyId: "11", name: "INV-001", moveType: { tag: "OutInvoice" }, partnerId: "31" },
  { id: next, organizationId: "7", companyId: "11", name: "BILL-001", moveType: { inInvoice: [] } },
  { id: "8", organizationId: "7", companyId: "12", name: "Other company", moveType: "OutInvoice" },
  { id: "9", organizationId: "8", companyId: "11", name: "Other organization", moveType: "OutInvoice" },
]
const contacts = [
  { id: "31", organizationId: "7", companyId: { none: [] }, displayName: "Acme" },
  { id: large, organizationId: "7", companyId: { some: "11" }, displayName: "Same-number contact" },
  { id: "32", organizationId: "7", companyId: { some: "12" }, displayName: "Other company contact" },
  { id: "33", organizationId: "8", companyId: null, displayName: "Other organization contact" },
  { id: "34", organizationId: "7", companyId: "invalid", displayName: "Invalid company" },
  { id: "35", organizationId: "7", displayName: "Missing company projection" },
  { id: "36", organizationId: "7", companyId: undefined, displayName: "Undefined company projection" },
  { id: "37", organizationId: "7", companyId: "", displayName: "Empty company projection" },
]

test("named choices use canonical models and exact authorized organization/company records", () => {
  const choices = messageRecordChoices(moves, contacts, scope, labels)
  assert.deepEqual(choices.map((choice) => choice.value).sort(), [`account_move:${large}`, `account_move:${next}`, "contact:31", `contact:${large}`].sort())
  assert.match(choices.find((choice) => choice.value === `account_move:${large}`)!.label, /Invoice · INV-001 · Acme/)
  assert.match(choices.find((choice) => choice.value === `account_move:${next}`)!.label, /Vendor bill · BILL-001/)
  assert.equal(choices.some((choice) => choice.label.includes("Other company")), false)
  assert.equal(choices.some((choice) => choice.label.includes("Other organization")), false)
  assert.equal(choices.some((choice) => choice.label.includes("company projection")), false)
})

test("record selection maps to the original model/resId keys without numeric rounding or hidden advanced values", () => {
  const choices = messageRecordChoices(moves, contacts, scope, labels)
  const formData = { recordLinkMode: "record", recordReference: `account_move:${large}`, model: "stale_model", resId: "99", parentId: "41" }
  assert.deepEqual(resolveMessageRecordChoice(formData, choices), { model: "account_move", resId: BigInt(large) })
  assert.deepEqual(resolveMessageRecordChoice({ recordLinkMode: "record", recordReference: `account_move:${next}` }, choices), { model: "account_move", resId: BigInt(next) })
  assert.deepEqual(resolveMessageRecordChoice({ recordLinkMode: "record", recordReference: `contact:${large}` }, choices), { model: "contact", resId: BigInt(large) })
})

test("stale, missing, ambiguous and cross-company named selections do not fall back to arbitrary references", () => {
  const choices = messageRecordChoices(moves, contacts, scope, labels)
  assert.equal(resolveMessageRecordChoice({ recordLinkMode: "record", recordReference: "account_move:8", model: "account_move", resId: "8" }, choices), null)
  assert.equal(resolveMessageRecordChoice({ recordLinkMode: "record", model: "account_move", resId: large }, choices), null)
  const changedCompany = messageRecordChoices(moves, contacts, { ...scope, companyId: "12" }, labels)
  assert.equal(resolveMessageRecordChoice({ recordLinkMode: "record", recordReference: `account_move:${large}` }, changedCompany), null)
  assert.equal(resolveMessageRecordChoice({ recordLinkMode: "record", recordReference: choices[0]!.value }, [choices[0]!, choices[0]!]), null)
  assert.equal(messageRecordChoices([moves[0]!, moves[0]!], [], scope, labels).length, 0)
})

test("Advanced custom reference retains existing models and full-range u64 IDs", () => {
  assert.deepEqual(resolveMessageRecordChoice({ recordLinkMode: "custom", model: "project_task", resId: "18446744073709551615", recordReference: `account_move:${large}` }, []), { model: "project_task", resId: 18446744073709551615n })
  assert.deepEqual(resolveMessageRecordChoice({ model: "sale_order", resId: large }, []), { model: "sale_order", resId: BigInt(large) })
  assert.deepEqual(resolveMessageRecordChoice({ recordLinkMode: "custom", resId: "42" }, []), { model: "mail.message", resId: 42n })
  for (const resId of [0, "-1", "2.5", "1e4", "18446744073709551616", Number(large)]) {
    assert.equal(resolveMessageRecordChoice({ recordLinkMode: "custom", model: "project_task", resId }, []), null)
  }
  assert.equal(resolveMessageRecordChoice({ recordLinkMode: "unexpected", model: "project_task", resId: "42" }, []), null)
})
