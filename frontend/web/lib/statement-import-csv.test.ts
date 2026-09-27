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

test("CSV-BOM strips a leading UTF-8 BOM before parsing statement headers", () => {
  const plain = statementImportRows(CSV)
  const withBom = statementImportRows(`\uFEFF${CSV}`)

  assert.deepEqual(withBom, plain)
  assert.equal(withBom.length, 1)
  assert.equal(withBom[0].rowNumber, 2)
  assert.equal(withBom[0].amount, 125.5)
  assert.equal(withBom[0].reference, "TX-001")
  assert.equal(withBom[0].description, "Customer transfer")
})

test("CSV-BOM normalization preserves statement import idempotency identity", async () => {
  const args = [1n, 2n, 3n] as const
  assert.equal(
    await statementImportIdempotencyKey(...args, `\uFEFF${CSV}`),
    await statementImportIdempotencyKey(...args, CSV),
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
    "2/13/2026,50.00,TX-006B",
  ].join("\n"))

  assert.equal(rows[0].date, undefined)
  assert.equal(rows[1].date, undefined)
})

test("CSV-03 keeps ISO statement dates accepted", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    "2026-02-13,125.50,TX-007",
  ].join("\n"))

  assert.notEqual(rows[0].date, undefined)
})


function legacyFnvStatementKey(
  companyId: bigint,
  journalId: bigint,
  currencyId: bigint,
  csvData: string,
): string {
  let hash = 2_166_136_261
  const source = `${companyId}:${journalId}:${currencyId}:${csvData.replace(/\r\n/g, "\n").trim()}`
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16_777_619)
  }
  return `statement-csv-${(hash >>> 0).toString(16)}`
}

test("CSV-04 separates distinct statement files that collide under the legacy 32-bit key", async () => {
  const csvA = [
    "date,amount,reference",
    "2026-07-01,76303,TX-76303",
  ].join("\n")
  const csvB = [
    "date,amount,reference",
    "2026-07-01,86018,TX-86018",
  ].join("\n")

  assert.equal(
    legacyFnvStatementKey(1n, 2n, 3n, csvA),
    legacyFnvStatementKey(1n, 2n, 3n, csvB),
  )

  const keyA = await statementImportIdempotencyKey(1n, 2n, 3n, csvA)
  const keyB = await statementImportIdempotencyKey(1n, 2n, 3n, csvB)
  assert.notEqual(keyA, keyB)
  assert.match(keyA, /^statement-csv-sha256-[0-9a-f]{64}$/)
  assert.match(keyB, /^statement-csv-sha256-[0-9a-f]{64}$/)
})

test("CSV-04 statement identity remains scoped by company, journal, and currency", async () => {
  const base = await statementImportIdempotencyKey(1n, 2n, 3n, CSV)
  assert.notEqual(base, await statementImportIdempotencyKey(9n, 2n, 3n, CSV))
  assert.notEqual(base, await statementImportIdempotencyKey(1n, 9n, 3n, CSV))
  assert.notEqual(base, await statementImportIdempotencyKey(1n, 2n, 9n, CSV))
})


test("CSV-01 parses European grouped decimals without changing economic value", () => {
  const rows = statementImportRows([
    "date;amount;reference",
    "2026-07-01;1.234,56;TX-EU-001",
    "2026-07-02;1.234.567,89;TX-EU-002",
    "2026-07-03;-1.234,56;TX-EU-003",
  ].join("\n"))

  assert.equal(rows[0].amount, 1_234.56)
  assert.equal(rows[1].amount, 1_234_567.89)
  assert.equal(rows[2].amount, -1_234.56)
})

test("CSV-01 preserves already-supported decimal comma and US mixed separators", () => {
  const europeanDecimal = statementImportRows([
    "date;amount;reference",
    "2026-07-01;12,34;TX-EU-004",
  ].join("\n"))
  const usDecimal = statementImportRows([
    "date,amount,reference",
    '2026-07-01,"1,234.56",TX-US-001',
  ].join("\n"))

  assert.equal(europeanDecimal[0].amount, 12.34)
  assert.equal(usDecimal[0].amount, 1_234.56)
})


test("CSV boundary rejects blank amounts instead of coercing them to zero", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    "2026-07-01,   ,TX-BLANK",
  ].join("\n"))

  assert.equal(rows[0].amount, undefined)
})

test("CSV boundary rejects impossible ISO calendar dates instead of normalizing them", () => {
  const rows = statementImportRows([
    "date,amount,reference",
    "2026-02-31,125.50,TX-DATE",
    "2026-02-29,50.00,TX-NONLEAP",
    "2028-02-29,75.00,TX-LEAP",
  ].join("\n"))

  assert.equal(rows[0].date, undefined)
  assert.equal(rows[1].date, undefined)
  assert.notEqual(rows[2].date, undefined)
})
