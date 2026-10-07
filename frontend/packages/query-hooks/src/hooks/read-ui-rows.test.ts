import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  statementKindForReportType,
  toBankStatementImportLineRow,
  toConsolidationCompanyRateRow,
  toStatementLineRow,
  toTaxDeadlineReminderRow,
} from "./read-ui-rows"

describe("statementKindForReportType", () => {
  it("maps tags and strings", () => {
    assert.equal(statementKindForReportType({ tag: "ProfitAndLoss" }), "profit-loss")
    assert.equal(statementKindForReportType("balance_sheet"), "balance-sheet")
    assert.equal(statementKindForReportType("CashFlow"), "cash-flow")
    assert.equal(statementKindForReportType("VatReturn"), null)
  })
})

describe("toStatementLineRow", () => {
  it("accepts snake_case and option shapes", () => {
    const row = toStatementLineRow({
      id: 5, report_id: "9", account_id: { some: 4 }, parent_id: null, line_type: "net_income",
      is_leaf: false, amount: 12.5, sequence: 3, level: 1,
    })
    assert.equal(row?.reportId, "9")
    assert.equal(row?.accountId, "4")
    assert.equal(row?.parentId, null)
    assert.equal(row?.lineType, "netincome")
    assert.equal(row?.isLeaf, false)
  })
  it("rejects rows without id; absent account stays null", () => {
    assert.equal(toStatementLineRow({}), null)
    assert.equal(toStatementLineRow({ id: "1" })?.accountId, null)
  })
})

describe("other mappers", () => {
  it("bank import line keeps absent columns null", () => {
    const row = toBankStatementImportLineRow({ id: "1", importId: "2", rowNumber: 3, amount: null })
    assert.equal(row?.amount, null)
    assert.equal(row?.reference, null)
    assert.equal(row?.createdStatementLineId, null)
  })
  it("tax reminder drops the recipient identity", () => {
    const row = toTaxDeadlineReminderRow({ id: "1", user_id: "abc", tax_deadline_id: 7, status: "pending" })
    assert.equal(row?.taxDeadlineId, "7")
    assert.equal("userId" in (row ?? {}), false)
  })
  it("company rate maps numbers", () => {
    const row = toConsolidationCompanyRateRow({ id: "1", company_id: 2, exchange_rate: "1.25", rate_type: { tag: "average" } })
    assert.equal(row?.exchangeRate, 1.25)
    assert.equal(row?.rateType, "average")
  })
})

import { importIdsApprovedIntoStatement, remindersForDeadline } from "./read-ui-rows"

describe("scoping helpers", () => {
  it("selects imports approved into a statement", () => {
    const ids = importIdsApprovedIntoStatement(
      [
        { id: 1, approved_statement_id: 10 },
        { id: "2", approvedStatementId: { some: "11" } },
        { id: 3, approvedStatementId: null },
      ],
      "10",
    )
    assert.deepEqual([...ids], ["1"])
  })
  it("filters reminders by deadline", () => {
    const a = toTaxDeadlineReminderRow({ id: 1, tax_deadline_id: 5 })!
    const b = toTaxDeadlineReminderRow({ id: 2, tax_deadline_id: 6 })!
    assert.deepEqual(remindersForDeadline([a, b], "5"), [a])
  })
})
