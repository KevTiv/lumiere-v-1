import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveBankStatementReconciliationEffect,
  type BankReconciliationLineProjection,
  type BankReconciliationStatementProjection,
} from "./accounting/bank-statements"
import { AmbiguousOperationEffectError } from "./operation-effect"

const line: BankReconciliationLineProjection = {
  id: "41",
  organizationId: 7n,
  statementId: "31",
  isReconciled: true,
  moveIds: [91n, "92"],
  amountResidual: 0,
}
const statement: BankReconciliationStatementProjection = {
  id: 31n,
  organizationId: "7",
  companyId: "8",
  state: { tag: "Open" },
}
const args = {
  organizationId: 7n,
  companyId: 8n,
  lineId: 41n,
  moveIds: [92n, 91n],
  amountResidual: 0,
}

describe("resolveBankStatementReconciliationEffect", () => {
  it("returns the exact company-scoped line and stable move-line set", () => {
    assert.deepEqual(resolveBankStatementReconciliationEffect([line], [statement], args), {
      resource: "bank-statement-lines",
      id: "41",
      statementId: "31",
      companyId: "8",
      moveLineIds: ["91", "92"],
      isReconciled: true,
    })
  })

  it("fails closed for wrong scope, closed statement, or effect set", () => {
    assert.equal(resolveBankStatementReconciliationEffect([line], [{ ...statement, companyId: 9n }], args), null)
    assert.equal(resolveBankStatementReconciliationEffect([line], [{ ...statement, state: "Posted" }], args), null)
    assert.equal(resolveBankStatementReconciliationEffect([{ ...line, moveIds: [91n] }], [statement], args), null)
  })

  it("rejects duplicate exact records as ambiguous", () => {
    assert.throws(
      () => resolveBankStatementReconciliationEffect([line, { ...line }], [statement], args),
      AmbiguousOperationEffectError,
    )
  })
})
