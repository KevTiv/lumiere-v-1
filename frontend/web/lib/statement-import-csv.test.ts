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
