import assert from "node:assert/strict"
import { test } from "node:test"
import {
  historyCalendarPeriod,
  historyCoverageUrl,
  historyQueryKey,
  historyQueryMatchesScope,
  historyRowsUrl,
  parseHistoryCoverage,
  parseHistoryRows,
  shiftHistoryDate,
  type HistoryFilters,
} from "./history-data"
import { sourceHistoryCoverage, sourceHistoryRows } from "./history-data.fixtures"

const scope = { organizationId: 42, companyId: 7, actorIdentity: "operator-one" }
const filters: HistoryFilters = { batchId: null, period: "all", timeZone: "Africa/Kigali", dateMode: "all", state: "all" }
const params = (path: string) => new URL(path, "https://example.test").searchParams

test("all source history leaves date boundaries open and preserves unknown rows", () => {
  const query = params(historyRowsUrl(7, filters))
  assert.equal(query.get("dateMode"), "all")
  assert.equal(query.get("from"), null)
  assert.equal(query.get("toExclusive"), null)
  assert.equal(query.get("limit"), "50")
  assert.equal(query.get("organizationId"), null)
  assert.equal(query.get("actorIdentity"), null)
})

test("custom history spans arbitrary years and includes the complete final calendar day", () => {
  const query = params(historyRowsUrl(7, { ...filters, period: { kind: "custom", from: "1940-01-01", through: "2023-01-31" } }))
  assert.equal(query.get("from"), "1940-01-01")
  assert.equal(query.get("toExclusive"), "2023-02-01")
  const leap = params(historyRowsUrl(7, { ...filters, period: { kind: "custom", from: "2024-02-29", through: "2024-02-29" } }))
  assert.equal(leap.get("toExclusive"), "2024-03-01")
})

test("undated and invalid-date filters never acquire guessed calendar boundaries", () => {
  for (const dateMode of ["undated", "invalid"] as const) {
    const query = params(historyRowsUrl(7, { ...filters, dateMode, period: { kind: "custom", from: "2022-01-01", through: "2022-12-31" } }))
    assert.equal(query.get("from"), null)
    assert.equal(query.get("toExclusive"), null)
    assert.equal(query.get("dateMode"), dateMode)
  }
})

test("cursor requests retain dataset, review state and coverage snapshot", () => {
  const query = params(historyRowsUrl(7, { ...filters, batchId: "11", state: "needs_review" }, "cursor+/=", "snapshot-1"))
  assert.equal(query.get("batchId"), "11")
  assert.equal(query.get("state"), "needs_review")
  assert.equal(query.get("cursor"), "cursor+/=")
  assert.equal(query.get("snapshot"), "snapshot-1")
  assert.equal(params(historyCoverageUrl(7, "cursor+/=")).get("cursor"), "cursor+/=")
  assert.throws(() => historyRowsUrl(0, filters), /operating company/)
})

test("coverage distinguishes full aggregates from an incomplete dataset page", () => {
  const fixture = sourceHistoryCoverage()
  const result = parseHistoryCoverage({ ...fixture, complete: false, nextCursor: "second-dataset-page" }, scope)
  assert.equal(result.aggregatesComplete, true)
  assert.equal(result.complete, false)
  assert.equal(result.totals.total, 2)
  assert.equal(result.totals.undated, 1)
  assert.equal(result.totals.minDate, "2022-10-31")
  assert.throws(() => parseHistoryCoverage({ ...fixture, complete: true, nextCursor: "second-dataset-page" }, scope), /invalid data/)
  assert.throws(() => parseHistoryCoverage({ ...fixture, aggregatesComplete: false }, scope), /invalid data/)
})

test("wrong tenant/company responses and changed continuation snapshots are rejected", () => {
  assert.throws(() => parseHistoryCoverage(sourceHistoryCoverage(8), scope), /does not match/)
  assert.throws(() => parseHistoryRows(sourceHistoryRows(7, 43), scope), /does not match/)
  assert.throws(() => parseHistoryCoverage(sourceHistoryCoverage(), scope, "older-snapshot"), /changed while loading/)
  assert.throws(() => parseHistoryRows(sourceHistoryRows(), scope, "older-snapshot"), /changed while loading/)
})

test("incomplete totals and malformed dates cannot render as valid coverage", () => {
  const fixture = sourceHistoryCoverage()
  assert.throws(() => parseHistoryCoverage({ ...fixture, totals: { ...fixture.totals, total: 3 } }, scope), /invalid data/)
  assert.throws(() => parseHistoryCoverage({ ...fixture, totals: { ...fixture.totals, minDate: "2022-02-31" } }, scope), /invalid data/)
  assert.throws(() => parseHistoryCoverage({ ...fixture, totals: { ...fixture.totals, dated: Number.MAX_SAFE_INTEGER + 1 } }, scope), /invalid data/)
  assert.throws(() => parseHistoryCoverage({ ...fixture, datasets: [...fixture.datasets, ...fixture.datasets] }, scope), /invalid data/)
})

test("unknown interpretation stays null while original source text remains inspectable", () => {
  const result = parseHistoryRows(sourceHistoryRows(), scope)
  const row = result.data[1]!
  assert.equal(row.businessDate.precision, "undated")
  assert.equal(row.businessDate.from, null)
  assert.equal(row.values.business_date, null)
  assert.equal(row.fields[0]!.sourceValue, "January")
  assert.equal(row.source.row, 9)
})

test("malformed row values and fabricated dates for undated rows fail closed", () => {
  const fixture = sourceHistoryRows(), row = fixture.data[1]!
  assert.throws(() => parseHistoryRows({ ...fixture, data: [{ ...row, values: { quantity: { value: 6 } } }] }, scope), /invalid data/)
  assert.throws(() => parseHistoryRows({ ...fixture, data: [{ ...row, businessDate: { ...row.businessDate, from: "2026-10-31" } }] }, scope), /invalid data/)
  assert.throws(() => parseHistoryRows({ ...fixture, data: [row, row] }, scope), /invalid data/)
})

test("query identities separate actors, organizations, companies, filters and snapshots", () => {
  const key = historyQueryKey("rows", scope, filters, "snapshot-1")
  for (const changed of [{ ...scope, actorIdentity: "operator-two" }, { ...scope, organizationId: 43 }, { ...scope, companyId: 8 }]) {
    assert.notDeepEqual(historyQueryKey("rows", changed, filters, "snapshot-1"), key)
  }
  assert.notDeepEqual(historyQueryKey("rows", scope, { ...filters, dateMode: "undated" }, "snapshot-1"), key)
  assert.notDeepEqual(historyQueryKey("rows", scope, filters, "snapshot-2"), key)
})

test("review refresh matches every history page for only the changed actor and company", () => {
  for (const key of [historyQueryKey("coverage", scope), historyQueryKey("rows", scope, filters, "old-snapshot")]) {
    assert.equal(historyQueryMatchesScope(key, scope), true)
    for (const other of [{ ...scope, actorIdentity: "operator-two" }, { ...scope, organizationId: 43 }, { ...scope, companyId: 8 }]) {
      assert.equal(historyQueryMatchesScope(key, other), false)
    }
  }
  const canonical = { ...scope, actorIdentity: "ab".repeat(32) }
  assert.equal(historyQueryMatchesScope(historyQueryKey("coverage", { ...canonical, actorIdentity: `0x${canonical.actorIdentity.toUpperCase()}` }), canonical), true)
  assert.equal(historyQueryMatchesScope(["import-reviews", 42, 7], scope), false)
  assert.equal(historyQueryMatchesScope(["available-history", "unrelated", "operator-one", 42, 7], scope), false)
})

test("year/month shortcuts and day arithmetic preserve historical dates and leap days", () => {
  assert.deepEqual(historyCalendarPeriod(2024, 2), { kind: "custom", from: "2024-02-01", through: "2024-02-29" })
  assert.deepEqual(historyCalendarPeriod(1940), { kind: "custom", from: "1940-01-01", through: "1940-12-31" })
  assert.deepEqual(historyCalendarPeriod(42, 2), { kind: "custom", from: "0042-02-01", through: "0042-02-28" })
  assert.equal(shiftHistoryDate("2023-01-01", -1), "2022-12-31")
  assert.throws(() => historyCalendarPeriod(2022, 13), /valid year/)
  assert.throws(() => shiftHistoryDate("2022-02-31", 1), /valid calendar date/)
})
