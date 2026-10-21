import assert from "node:assert/strict"
import test from "node:test"

import {
  AccountingImportReconciliationError,
  assertDebitCreditRowsBalanced,
  parseAccountingImportNumber,
  reconcileDebitCreditRows,
} from "./accounting-import-reconciliation"

const headers = ["Reference", "Account", "Debit", "Credit"]
const mapping = { Account: "account_id", Debit: "debit", Credit: "credit" }

test("accounting amount parsing matches supported server locale formats", () => {
  assert.equal(parseAccountingImportNumber("1234.56"), 1_234.56)
  assert.equal(parseAccountingImportNumber("1,234.56"), 1_234.56)
  assert.equal(parseAccountingImportNumber("1.234,56"), 1_234.56)
  assert.equal(parseAccountingImportNumber("12,34"), 12.34)
  assert.equal(parseAccountingImportNumber("1,234"), 1_234)
  assert.equal(parseAccountingImportNumber(" - 1 234,50 "), -1_234.5)
  assert.equal(parseAccountingImportNumber(""), null)
})

test("accounting amount parsing rejects malformed and non-finite input", () => {
  for (const value of ["12,34.56", "1,23,456", "NaN", "1e309"]) {
    assert.throws(() => parseAccountingImportNumber(value))
  }
})

test("reconciliation accepts localized debit and credit values", () => {
  const report = reconcileDebitCreditRows({
    headers,
    rows: [
      ["MOVE-1", "1100", "1.234,56", ""],
      ["MOVE-1", "3000", "", "1,234.56"],
    ],
    lineMapping: mapping,
    parentReferenceSourceColumn: "Reference",
  })
  assert.equal(report.valid, true)
  assert.equal(report.totalDebit, 1_234.56)
  assert.equal(report.totalCredit, 1_234.56)
})

test("reconcileDebitCreditRows requires each journal reference to balance", () => {
  const report = reconcileDebitCreditRows({
    headers,
    rows: [
      ["MOVE-1", "1100", "100.10", ""],
      ["MOVE-1", "3000", "", "100.10"],
      ["MOVE-2", "1200", "50", ""],
      ["MOVE-2", "4000", "", "50"],
    ],
    lineMapping: mapping,
    parentReferenceSourceColumn: "Reference",
  })

  assert.equal(report.valid, true)
  assert.equal(report.difference, 0)
  assert.deepEqual(
    report.groups.map((group) => [group.reference, group.balanced]),
    [
      ["MOVE-1", true],
      ["MOVE-2", true],
    ],
  )
})

test("offsetting unbalanced entries do not pass a balanced grand total", () => {
  const report = reconcileDebitCreditRows({
    headers,
    rows: [
      ["MOVE-1", "1100", "100", ""],
      ["MOVE-1", "3000", "", "90"],
      ["MOVE-2", "1200", "90", ""],
      ["MOVE-2", "4000", "", "100"],
    ],
    lineMapping: mapping,
    parentReferenceSourceColumn: "Reference",
  })

  assert.equal(report.difference, 0)
  assert.equal(report.valid, false)
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ["unbalanced_reference", "unbalanced_reference"],
  )
})

test("reconciliation reports malformed line amounts explicitly", () => {
  const report = reconcileDebitCreditRows({
    headers,
    rows: [
      ["MOVE-1", "1100", "ten", ""],
      ["MOVE-1", "3000", "", "10"],
      ["MOVE-2", "1100", "5", "5"],
      ["MOVE-3", "1100", "", ""],
      ["", "1100", "1", ""],
    ],
    lineMapping: mapping,
    parentReferenceSourceColumn: "Reference",
  })

  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    [
      "invalid_amount",
      "mixed_debit_credit",
      "empty_amount",
      "missing_reference",
    ],
  )
})

test("assertDebitCreditRowsBalanced exposes the full reconciliation report", () => {
  assert.throws(
    () =>
      assertDebitCreditRowsBalanced({
        headers,
        rows: [["MOVE-1", "1100", "20", ""]],
        lineMapping: mapping,
        parentReferenceSourceColumn: "Reference",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AccountingImportReconciliationError)
      assert.equal(error.report.groups[0]?.difference, 20)
      assert.equal(error.report.issues[0]?.code, "unbalanced_reference")
      return true
    },
  )
})
