import assert from "node:assert/strict"
import { test } from "node:test"
import {
  financeReviewInput,
  type FinanceReviewFields,
} from "./finance-review-model"
const fields: FinanceReviewFields = {
  reportKey: "customer_balances_v1",
  date: "2026-10-26",
  baselineDate: "2026-10-25",
  timezone: "UTC",
  recordId: "42",
  recordKind: "expense",
  query: "Explain the evidence",
}
test("each finance form produces only the parameters for its selected workflow", () => {
  assert.deepEqual(financeReviewInput("bank_reconciliation_review", fields), {
    statementId: 42,
    query: fields.query,
  })
  assert.deepEqual(financeReviewInput("period_close_review", fields), {
    periodId: 42,
    query: fields.query,
  })
  assert.deepEqual(financeReviewInput("expense_evidence_review", fields), {
    recordId: 42,
    recordKind: "expense",
    query: fields.query,
  })
  assert.deepEqual(financeReviewInput("finance_report_review", fields), {
    reportKey: fields.reportKey,
    date: fields.date,
    timezone: "UTC",
    query: fields.query,
  })
  assert.deepEqual(financeReviewInput("finance_variance_review", fields), {
    reportKey: fields.reportKey,
    actualDate: fields.date,
    baselineDate: fields.baselineDate,
    timezone: "UTC",
    query: fields.query,
  })
})
test("invalid dates, timezones, report keys, IDs and empty comparisons never submit", () => {
  for (const patch of [
    { date: "2026-02-30" },
    { timezone: "missing/zone" },
    { reportKey: "arbitrary_sql" },
  ])
    assert.equal(
      financeReviewInput("finance_report_review", { ...fields, ...patch }),
      null,
    )
  for (const recordId of ["0", "-1", "1.5", "9007199254740993", "NaN", ""])
    assert.equal(
      financeReviewInput("period_close_review", { ...fields, recordId }),
      null,
    )
  assert.equal(
    financeReviewInput("finance_variance_review", {
      ...fields,
      baselineDate: fields.date,
    }),
    null,
  )
  assert.equal(
    financeReviewInput("expense_evidence_review", {
      ...fields,
      recordKind: "document_url",
    }),
    null,
  )
})

test("reporting timezone must be explicitly selected and is never inferred", () => {
  for (const skill of ["finance_report_review", "finance_variance_review"] as const) {
    assert.equal(financeReviewInput(skill, { ...fields, timezone: "" }), null)
    assert.equal(financeReviewInput(skill, { ...fields, timezone: "  " }), null)
    assert.ok(financeReviewInput(skill, { ...fields, timezone: "Africa/Kigali" }))
  }
  assert.deepEqual(financeReviewInput("bank_reconciliation_review", { ...fields, timezone: "" }), {
    statementId: 42, query: fields.query,
  })
})
