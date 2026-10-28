import assert from "node:assert/strict"
import test from "node:test"
import { approvalInboxTarget, approvalTaskMatchesTarget, approvalSubjectKind } from "./approval-inbox-view"

test("approval inbox target accepts only an exact model and positive record id", () => {
  assert.deepEqual(approvalInboxTarget("purchase_order", "42"), { model: "purchase_order", resId: 42 })
  for (const input of [[null, "42"], ["purchase_order", null], ["purchase_order", "0"], ["purchase_order", "4x"]] as const) {
    assert.equal(approvalInboxTarget(input[0], input[1]), null)
  }
})

test("approval subject labels use supported business kinds and do not invent unknown source titles", () => {
  assert.equal(approvalSubjectKind("purchase_order"), "purchaseOrder")
  assert.equal(approvalSubjectKind("sale_order"), "salesOrder")
  assert.equal(approvalSubjectKind("account_move"), "accountingDocument")
  assert.equal(approvalSubjectKind("account_payment"), "payment")
  assert.equal(approvalSubjectKind("expense_sheet"), "expenseReport")
  assert.equal(approvalSubjectKind("internal_private_model"), "record")
  assert.equal(approvalSubjectKind(undefined), "record")
})

test("approval target matches canonical, snake-case and summary task subjects", () => {
  const target = { model: "purchase_order", resId: 42 }
  assert.equal(approvalTaskMatchesTarget({ id: 1, subjectModel: "purchase_order", subjectId: 42 }, target), true)
  assert.equal(approvalTaskMatchesTarget({ id: 2, subject_model: "purchase_order", subject_id: 42 }, target), true)
  assert.equal(approvalTaskMatchesTarget({ id: 3, summary: { subjectModel: "purchase_order", subjectId: 42 } }, target), true)
  assert.equal(approvalTaskMatchesTarget({ id: 4, subjectModel: "purchase_order", subjectId: 43 }, target), false)
})
