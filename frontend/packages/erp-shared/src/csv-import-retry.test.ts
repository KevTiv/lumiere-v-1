import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRetryFileName,
  csvDataRowIndexFromJobError,
  filterRowsForRetry,
  uniqueFailedRowNumbers,
} from "./csv-import-retry"

test("csvDataRowIndexFromJobError converts 1-based csv row numbers", () => {
  assert.equal(csvDataRowIndexFromJobError(2), 0)
  assert.equal(csvDataRowIndexFromJobError(5), 3)
})

test("uniqueFailedRowNumbers deduplicates job error rows", () => {
  assert.deepEqual(
    uniqueFailedRowNumbers([
      { row_number: 2 },
      { row_number: 2 },
      { row_number: 4 },
      { row_number: 1 },
    ]),
    [2, 4],
  )
})

test("filterRowsForRetry keeps only failed data rows", () => {
  const headers = ["name"]
  const rows = [["a"], ["b"], ["c"]]
  const filtered = filterRowsForRetry(headers, rows, [2, 4])
  assert.deepEqual(filtered.rows, [["a"], ["c"]])
  assert.equal(filtered.rowCount, 2)
})

test("buildRetryFileName suffixes retry", () => {
  assert.equal(buildRetryFileName("orders.csv"), "orders-retry.csv")
})
