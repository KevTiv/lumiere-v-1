import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  hrPayslipStateTag,
  resolvePayslipPostingEffect,
  resolvePayslipStateEffect,
} from "./hr-payroll-effects"

const scope = { organization_id: "7", company_id: "11" }

test("COV-09 normalises payslip state and resolves only the exact scoped transition", () => {
  assert.equal(hrPayslipStateTag({ tag: "Verify" }), "Verify")
  assert.equal(hrPayslipStateTag({ cancelled: [] }), "Cancelled")
  assert.deepEqual(
    resolvePayslipStateEffect(
      [{ ...scope, id: "42", state: { tag: "Verify" } }],
      7n,
      11n,
      42n,
      "Verify",
    ),
    { resource: "payslips", id: "42" },
  )
  assert.equal(
    resolvePayslipStateEffect(
      [{ ...scope, id: "42", state: "Draft" }],
      7n,
      11n,
      42n,
      "Verify",
    ),
    null,
  )
})

test("COV-09 posting resolves the canonical payslip to GL handoff", () => {
  assert.deepEqual(
    resolvePayslipPostingEffect(
      [{ ...scope, id: 42, state: "Done", account_move_id: 99 }],
      [{ ...scope, id: 99 }],
      7n,
      11n,
      42n,
    ),
    { resource: "account-moves", id: "99" },
  )
  assert.equal(
    resolvePayslipPostingEffect(
      [{ ...scope, id: 42, state: "Done", account_move_id: 99 }],
      [{ ...scope, id: 100 }],
      7n,
      11n,
      42n,
    ),
    null,
  )
})

test("COV-09 payroll effect resolution rejects duplicate canonical rows", () => {
  assert.throws(
    () =>
      resolvePayslipStateEffect(
        [
          { ...scope, id: 42, state: "Verify" },
          { ...scope, id: 42, state: "Verify" },
        ],
        7n,
        11n,
        42n,
        "Verify",
      ),
    AmbiguousOperationEffectError,
  )
})
