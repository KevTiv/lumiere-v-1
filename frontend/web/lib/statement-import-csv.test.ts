import assert from "node:assert/strict"
import test from "node:test"

import {
  statementImportIdempotencyKey,
  statementImportRows,
} from "./statement-import-csv"

const CSV = [
  "date,amount,reference,description",
  "2026-07-01,125.50,TX-001,Customer transfer",
].join("\n")

test("CSV-01 strips a leading UTF-8 BOM before parsing statement headers", () => {
  const plain = statementImportRows(CSV)
  const withBom = statementImportRows(`\uFEFF${CSV}`)

  assert.deepEqual(withBom, plain)
  assert.equal(withBom.length, 1)
  assert.equal(withBom[0].rowNumber, 2)
  assert.equal(withBom[0].amount, 125.5)
  assert.equal(withBom[0].reference, "TX-001")
  assert.equal(withBom[0].description, "Customer transfer")
})

test("CSV-01 BOM normalization preserves statement import idempotency identity", () => {
  const args = [1n, 2n, 3n] as const
  assert.equal(
    statementImportIdempotencyKey(...args, `\uFEFF${CSV}`),
    statementImportIdempotencyKey(...args, CSV),
  )
})


test("CSV-02 parses a quoted US thousands separator as grouping, not a decimal comma", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    '2026-07-01,"1,234",TX-001',
    '2026-07-02,"1,234,567",TX-002',
  ].join("\n"))

  assert.equal(rows[0].amount, 1_234)
  assert.equal(rows[1].amount, 1_234_567)
})

test("CSV-02 keeps ordinary decimal-comma amounts as decimals", () => {
  const rows = statementImportRows([
    "date;amount;reference",
    "2026-07-01;12,34;TX-003",
  ].join("\n"))

  assert.equal(rows[0].amount, 12.34)
})


test("CSV-03 fails closed on ambiguous slash dates instead of assuming DD/MM", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    "02/03/2026,125.50,TX-004",
    "03/02/2026,50.00,TX-005",
  ].join("\n"))

  assert.equal(rows[0].date, undefined)
  assert.equal(rows[1].date, undefined)
})

test("CSV-03 also requires an explicit format for otherwise inferable slash dates", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    "13/02/2026,125.50,TX-006",
  ].join("\n"))

  assert.equal(rows[0].date, undefined)
})

test("CSV-03 keeps ISO statement dates accepted", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    "2026-02-13,125.50,TX-007",
  ].join("\n"))

  assert.notEqual(rows[0].date, undefined)
})
