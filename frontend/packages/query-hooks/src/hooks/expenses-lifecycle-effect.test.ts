import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveExpenseSheetStateEffect,
  resolvePostedExpenseSheetEffect,
  resolveReimbursedExpenseSheetEffect,
} from "./expenses"
import { AmbiguousOperationEffectError } from "./operation-effect"

const sheet = {
  id: "41",
  organizationId: "7",
  companyId: "8",
  state: { tag: "Submitted" },
}

const move = (id: string) => ({
  id,
  organizationId: "7",
  companyId: "8",
  state: { tag: "Posted" },
})

describe("COV-11 expense-sheet exact effects", () => {
  it("resolves submit/approve only for the same scoped sheet", () => {
    assert.deepEqual(
      resolveExpenseSheetStateEffect([sheet], 7n, 8n, 41n, "Submitted"),
      {
        resource: "expense-sheets",
        id: "41",
        state: "Submitted",
        companyId: "8",
      },
    )
    assert.deepEqual(
      resolveExpenseSheetStateEffect(
        [{ ...sheet, state: { approved: [] } }],
        7n,
        8n,
        41n,
        "Approved",
      ),
      {
        resource: "expense-sheets",
        id: "41",
        state: "Approved",
        companyId: "8",
      },
    )
    assert.equal(
      resolveExpenseSheetStateEffect(
        [{ ...sheet, companyId: "9" }],
        7n,
        8n,
        41n,
        "Submitted",
      ),
      null,
    )
  })

  it("resolves post through the sheet's exact account_move_id", () => {
    assert.deepEqual(
      resolvePostedExpenseSheetEffect(
        [
          {
            ...sheet,
            state: "Posted",
            accountMoveId: "501",
          },
        ],
        [move("501")],
        7n,
        8n,
        41n,
      ),
      {
        resource: "expense-sheets",
        id: "41",
        state: "Posted",
        companyId: "8",
        accountMoveId: "501",
      },
    )
    assert.equal(
      resolvePostedExpenseSheetEffect(
        [{ ...sheet, state: "Posted", accountMoveId: "501" }],
        [{ ...move("501"), companyId: "9" }],
        7n,
        8n,
        41n,
      ),
      null,
    )
  })

  it("resolves reimbursement only when source and reimbursement moves are exact", () => {
    assert.deepEqual(
      resolveReimbursedExpenseSheetEffect(
        [
          {
            ...sheet,
            state: { done: [] },
            account_move_id: "501",
            reimbursement_move_id: "777",
          },
        ],
        [move("501"), move("777")],
        7n,
        8n,
        41n,
      ),
      {
        resource: "expense-sheets",
        id: "41",
        state: "Done",
        companyId: "8",
        accountMoveId: "501",
        reimbursementMoveId: "777",
      },
    )
    assert.equal(
      resolveReimbursedExpenseSheetEffect(
        [
          {
            ...sheet,
            state: "Done",
            accountMoveId: "501",
            reimbursementMoveId: "777",
          },
        ],
        [move("501")],
        7n,
        8n,
        41n,
      ),
      null,
    )
  })

  it("rejects duplicate sheet or move identity", () => {
    assert.throws(
      () =>
        resolveExpenseSheetStateEffect(
          [sheet, { ...sheet }],
          7n,
          8n,
          41n,
          "Submitted",
        ),
      AmbiguousOperationEffectError,
    )
    assert.throws(
      () =>
        resolvePostedExpenseSheetEffect(
          [{ ...sheet, state: "Posted", accountMoveId: "501" }],
          [move("501"), move("501")],
          7n,
          8n,
          41n,
        ),
      AmbiguousOperationEffectError,
    )
  })
})
