import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  expenseSheetReimbursementMoveId,
  expenseSheetStateTag,
  resolveExpenseSheetEffect,
  type ExpenseSheetEffectProjection,
} from "./expense-sheet-lifecycle"

const row = (
  id: bigint,
  state: unknown,
  extra: Partial<ExpenseSheetEffectProjection> = {},
): ExpenseSheetEffectProjection => ({ id, organizationId: 1n, companyId: 3n, state, ...extra })

const SUBMITTED = { states: ["Submitted"] } as const

test("normalises SATS enum shapes", () => {
  assert.equal(expenseSheetStateTag("Posted"), "Posted")
  assert.equal(expenseSheetStateTag({ tag: "Done" }), "Done")
  assert.equal(expenseSheetStateTag({ approved: [] }), "Approved")
  assert.equal(expenseSheetStateTag(undefined), "")
})

test("resolves the exact sheet in an expected state", () => {
  const rows = [row(4n, "Draft"), row(5n, { tag: "Submitted" })]
  assert.deepEqual(resolveExpenseSheetEffect(rows, 1n, 3n, 5n, SUBMITTED), { resource: "expense-sheets", id: "5" })
})

test("accepts snake_case rows and an unknown company", () => {
  const rows = [{ id: "5", organization_id: "1", company_id: "9", state: "Approved" }]
  assert.deepEqual(resolveExpenseSheetEffect(rows, 1n, undefined, 5n, { states: ["Approved"] }), {
    resource: "expense-sheets",
    id: "5",
  })
  assert.equal(resolveExpenseSheetEffect(rows, 1n, 3n, 5n, { states: ["Approved"] }), null)
})

test("returns null for the wrong state, e.g. approval routed to a human task", () => {
  assert.equal(resolveExpenseSheetEffect([row(5n, "Submitted")], 1n, 3n, 5n, { states: ["Approved"] }), null)
})

test("returns null for a missing sheet or another organization", () => {
  assert.equal(resolveExpenseSheetEffect([row(6n, "Submitted")], 1n, 3n, 5n, SUBMITTED), null)
  assert.equal(
    resolveExpenseSheetEffect([row(5n, "Submitted", { organizationId: 2n })], 1n, 3n, 5n, SUBMITTED),
    null,
  )
})

test("throws on duplicate sheet ids", () => {
  assert.throws(
    () => resolveExpenseSheetEffect([row(5n, "Submitted"), row(5n, "Submitted")], 1n, 3n, 5n, SUBMITTED),
    AmbiguousOperationEffectError,
  )
})

test("post requires the sheet's own posting move", () => {
  const expected = { states: ["Posted"], requirePostingMove: true } as const
  assert.equal(resolveExpenseSheetEffect([row(5n, "Posted")], 1n, 3n, 5n, expected), null)
  assert.equal(resolveExpenseSheetEffect([row(5n, "Posted", { accountMoveId: { none: [] } })], 1n, 3n, 5n, expected), null)
  assert.deepEqual(
    resolveExpenseSheetEffect([row(5n, "Posted", { accountMoveId: 40n })], 1n, 3n, 5n, expected),
    { resource: "expense-sheets", id: "5" },
  )
  assert.deepEqual(
    resolveExpenseSheetEffect([row(5n, "Posted", { account_move_id: { some: 40n } })], 1n, 3n, 5n, expected),
    { resource: "expense-sheets", id: "5" },
  )
})

test("reimburse needs a reimbursement move that changed and is not the posting move", () => {
  const states = ["Posted", "Done"] as const
  const rows = (reimbursementMoveId: unknown) => [
    row(5n, "Done", { accountMoveId: 40n, reimbursementMoveId }),
  ]
  // No reimbursement move at all.
  assert.equal(resolveExpenseSheetEffect(rows(null), 1n, 3n, 5n, { states, reimbursementMoveChangedFrom: null }), null)
  // First reimbursement.
  assert.deepEqual(
    resolveExpenseSheetEffect(rows(41n), 1n, 3n, 5n, { states, reimbursementMoveChangedFrom: null }),
    { resource: "expense-sheets", id: "5" },
  )
  // An earlier partial reimbursement does not prove a later one.
  assert.equal(resolveExpenseSheetEffect(rows(41n), 1n, 3n, 5n, { states, reimbursementMoveChangedFrom: 41n }), null)
  assert.deepEqual(
    resolveExpenseSheetEffect(rows(42n), 1n, 3n, 5n, { states, reimbursementMoveChangedFrom: 41n }),
    { resource: "expense-sheets", id: "5" },
  )
  // The posting move is never accepted as the reimbursement.
  assert.equal(resolveExpenseSheetEffect(rows(40n), 1n, 3n, 5n, { states, reimbursementMoveChangedFrom: null }), null)
})

test("reads the prior reimbursement move for the exact id and organization", () => {
  const rows = [row(5n, "Posted", { reimbursementMoveId: 41n }), row(6n, "Posted")]
  assert.equal(expenseSheetReimbursementMoveId(rows, 1n, 5n), 41n)
  assert.equal(expenseSheetReimbursementMoveId(rows, 1n, 6n), null)
  assert.equal(expenseSheetReimbursementMoveId(rows, 2n, 5n), null)
  assert.equal(expenseSheetReimbursementMoveId(rows, 1n, 7n), null)
})
