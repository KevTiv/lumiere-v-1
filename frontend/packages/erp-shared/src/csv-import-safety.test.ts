import assert from "node:assert/strict"
import test from "node:test"

import { isFormulaInjection, scanCsvMatrix } from "./csv-import-safety"

test("detects spreadsheet formula injection", () => {
  assert.equal(isFormulaInjection("=1+1"), true)
  assert.equal(isFormulaInjection("safe value"), false)
})

test("scanCsvMatrix reports blocked cells", () => {
  const report = scanCsvMatrix(["Name"], [["=cmd|'/c calc'!A0"]])
  assert.equal(report.isSafeForAi, false)
  assert.ok(report.blockedCellCount >= 1)
})
