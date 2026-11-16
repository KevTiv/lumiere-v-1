import assert from "node:assert/strict"
import test from "node:test"

import { buildPivotTable } from "./pivot-table-model"

const options = {
  rowDimension: "accountCode",
  columnDimension: "",
  measureField: "closingDebit",
  measureOp: "sum",
} as const

function displayedRows(pivot: ReturnType<typeof buildPivotTable>) {
  return pivot.tableRows.map((row) => pivot.columns.map(({ key }) => row[key]))
}

test("the same pivot columns drive the visible ungrouped table and export", () => {
  const pivot = buildPivotTable([
    { accountCode: "100", closingDebit: 125 },
    { account_code: "100", closing_debit: "25" },
  ], options)
  assert.deepEqual(pivot.exportHeaders, ["accountCode", "sum(closingDebit)"])
  assert.deepEqual(displayedRows(pivot), [["100", 150]])
  assert.deepEqual(pivot.exportRows, [["100", 150]])
})

test("column groups retain independent keys and line up with exported values", () => {
  const pivot = buildPivotTable([
    { accountCode: "100", accountType: "Other income", closingDebit: 50 },
    { accountCode: "100", accountType: "Other-income", closingDebit: 125 },
  ], { ...options, columnDimension: "accountType" })
  assert.deepEqual(pivot.exportHeaders, ["accountCode", "Other income", "Other-income"])
  assert.deepEqual(displayedRows(pivot), [["100", 50, 125]])
  assert.deepEqual(pivot.exportRows, [["100", 50, 125]])
})

test("withheld or invalid measures leave the cell blank, preserving real zero amounts", () => {
  const pivot = buildPivotTable([
    { accountCode: "100", accountType: "Asset", closingDebit: 0 },
    { accountCode: "100", accountType: "Expense", closingDebit: " " },
    { accountCode: "200", accountType: "Asset", closingDebit: 125 },
    { accountCode: "200", accountType: "Asset", closingDebit: null },
    { accountCode: "300", accountType: "Asset", closingDebit: false },
  ], { ...options, columnDimension: "accountType" })
  assert.deepEqual(displayedRows(pivot), [["100", 0, null], ["200", null, null], ["300", null, null]])
  assert.deepEqual(pivot.exportRows, [["100", 0, ""], ["200", "", ""], ["300", "", ""]])
})

test("saved definitions use the persisted aggregation", () => {
  const rows = [{ accountCode: "100", closingDebit: 25 }, { accountCode: "100", closingDebit: 125 }]
  for (const [measureOp, expected] of [["avg", 75], ["min", 25], ["max", 125], ["count", 2]] as const) {
    const pivot = buildPivotTable(rows, { ...options, measureOp })
    assert.deepEqual(displayedRows(pivot), [["100", expected]])
  }
})
