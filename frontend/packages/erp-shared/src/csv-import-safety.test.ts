import assert from "node:assert/strict"
import test from "node:test"

import { isFormulaInjection, scanCsvMatrix, splitCsvRow, parseCsvText } from "./csv-import-safety"

test("detects spreadsheet formula injection", () => {
  assert.equal(isFormulaInjection("=1+1"), true)
  assert.equal(isFormulaInjection("safe value"), false)
})

test("scanCsvMatrix reports blocked cells", () => {
  const report = scanCsvMatrix(["Name"], [["=cmd|'/c calc'!A0"]])
  assert.equal(report.isSafeForAi, false)
  assert.ok(report.blockedCellCount >= 1)
})

// ── splitCsvRow parity tests (match Rust split_csv_row behavior) ────────────────

test("splitCsvRow parses simple comma-separated values", () => {
  assert.deepEqual(splitCsvRow("a,b,c"), ["a", "b", "c"])
})

test("splitCsvRow trims whitespace from fields", () => {
  assert.deepEqual(splitCsvRow("  a  , b ,c"), ["a", "b", "c"])
})

test("splitCsvRow handles quoted fields with commas", () => {
  assert.deepEqual(splitCsvRow('"a,b",c'), ["a,b", "c"])
})

test("splitCsvRow handles escaped quotes inside quoted fields", () => {
  assert.deepEqual(splitCsvRow('"say ""hi""",c'), ['say "hi"', "c"])
})

test("splitCsvRow handles empty fields", () => {
  assert.deepEqual(splitCsvRow("a,,c"), ["a", "", "c"])
  assert.deepEqual(splitCsvRow(""), [""])
})

test("splitCsvRow handles trailing comma", () => {
  assert.deepEqual(splitCsvRow("a,b,"), ["a", "b", ""])
})

test("splitCsvRow preserves content in quotes", () => {
  assert.deepEqual(splitCsvRow('"  spaces  ",x'), ["spaces", "x"])
})

// ── parseCsvText blank-line policy ──────────────────────────────────────────────

test("parseCsvText filters blank lines", () => {
  const csv = "name,age\nAlice,30\n\nBob,25"
  const { headers, rows } = parseCsvText(csv)
  assert.deepEqual(headers, ["name", "age"])
  assert.equal(rows.length, 2, "blank line should be filtered")
  assert.deepEqual(rows[0], ["Alice", "30"])
  assert.deepEqual(rows[1], ["Bob", "25"])
})
