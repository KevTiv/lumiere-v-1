import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createHistoryBuckets,
  historyDateAt,
  historyPeriodDates,
  isHistoryDate,
  isHistoryTimestampInRange,
  parseHistoryPeriod,
  previousHistoryPeriod,
  resolveHistoryPeriod,
  serializeHistoryBounds,
  serializeHistoryPeriod,
  validateHistoryPeriod,
  type HistoryPeriod,
} from "./history-period"

const custom = (from: string, through = from): HistoryPeriod => ({ kind: "custom", from, through })
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()

test("custom ranges include every selected company-calendar date across both DST transitions", () => {
  const spring = resolveHistoryPeriod(custom("2024-03-10"), { timeZone: "America/New_York" })
  assert.equal(iso(spring.startMs), "2024-03-10T05:00:00.000Z")
  assert.equal(iso(spring.endMs), "2024-03-11T04:00:00.000Z")
  assert.equal(spring.endMs! - spring.startMs!, 23 * 60 * 60 * 1000)
  const autumn = resolveHistoryPeriod(custom("2024-11-03"), { timeZone: "America/New_York" })
  assert.equal(iso(autumn.startMs), "2024-11-03T04:00:00.000Z")
  assert.equal(iso(autumn.endMs), "2024-11-04T05:00:00.000Z")
  assert.equal(autumn.endMs! - autumn.startMs!, 25 * 60 * 60 * 1000)
})

test("date boundaries handle midnight DST and a skipped local calendar date", () => {
  const midnightTransition = resolveHistoryPeriod(custom("2018-11-04"), { timeZone: "America/Sao_Paulo" })
  assert.equal(iso(midnightTransition.startMs), "2018-11-04T03:00:00.000Z")
  assert.equal(iso(midnightTransition.endMs), "2018-11-05T02:00:00.000Z")
  const skipped = resolveHistoryPeriod(custom("2011-12-30"), { timeZone: "Pacific/Apia" })
  assert.equal(skipped.startMs, skipped.endMs)
})

test("adjacent periods exclude their exact end and never count the same boundary twice", () => {
  const first = resolveHistoryPeriod(custom("2020-01-01"))
  const second = resolveHistoryPeriod(custom("2020-01-02"))
  assert.equal(first.endMs, second.startMs)
  assert.equal(isHistoryTimestampInRange(first.startMs, first), true)
  assert.equal(isHistoryTimestampInRange(first.endMs! - 1, first), true)
  assert.equal(isHistoryTimestampInRange(first.endMs, first), false)
  assert.equal(isHistoryTimestampInRange(first.endMs, second), true)
})

test("presets follow the company date rather than the browser or UTC date", () => {
  const options = { now: new Date("2025-01-01T00:30:00Z"), timeZone: "America/Los_Angeles" }
  assert.deepEqual(historyPeriodDates("today", options), { from: "2024-12-31", through: "2024-12-31" })
  assert.deepEqual(historyPeriodDates("7d", options), { from: "2024-12-25", through: "2024-12-31" })
  assert.deepEqual(historyPeriodDates("ytd", options), { from: "2024-01-01", through: "2024-12-31" })
  assert.deepEqual(historyPeriodDates("180d", { now: new Date("2024-06-28T12:00:00Z") }), {
    from: "2024-01-01", through: "2024-06-28",
  })
})

test("arbitrary ranges preserve more than ten years, pre-epoch dates, and years below 100", () => {
  const bounds = resolveHistoryPeriod(custom("1940-06-01", "2025-09-30"))
  assert.equal(iso(bounds.startMs), "1940-06-01T00:00:00.000Z")
  assert.equal(iso(bounds.endMs), "2025-10-01T00:00:00.000Z")
  assert.equal(isHistoryTimestampInRange(Date.parse("1962-02-05T12:00:00Z"), bounds), true)
  const ancient = resolveHistoryPeriod(custom("0099-01-01", "0099-12-31"))
  assert.equal(iso(ancient.startMs), "0099-01-01T00:00:00.000Z")
  assert.equal(iso(ancient.endMs), "0100-01-01T00:00:00.000Z")
  assert.equal(historyDateAt(-0.001), "1969-12-31")
  assert.deepEqual(historyPeriodDates("all", { coverage: { startMs: -0.001, endMs: 0.001 } }), {
    from: "1969-12-31", through: "1970-01-01",
  })
})

test("strict validation rejects impossible, incomplete, non-canonical and reversed dates", () => {
  for (const date of ["2023-02-29", "1900-02-29", "2024-04-31", "2024-13-01", "0000-01-01", "2024-1-01", "2024-01", ""]) {
    assert.equal(isHistoryDate(date), false, date)
    assert.equal(validateHistoryPeriod(custom(date)).valid, false)
  }
  assert.equal(isHistoryDate("2000-02-29"), true)
  assert.equal(isHistoryDate("0001-01-01"), true)
  assert.deepEqual(validateHistoryPeriod(custom("2025-01-02", "2025-01-01")), { valid: false, error: "reversed" })
  assert.throws(() => resolveHistoryPeriod(custom("2025-01-02", "2025-01-01")), RangeError)
  assert.equal(validateHistoryPeriod({ kind: "custom", from: "2025-01-01" }).valid, false)
})

test("all history keeps unknown/open coverage explicit and does not assign undated rows to epoch", () => {
  const all = resolveHistoryPeriod("all", { now: new Date("2025-01-01") })
  assert.deepEqual(all, { startMs: null, endMs: null })
  assert.deepEqual(historyPeriodDates("all"), { from: null, through: null })
  assert.deepEqual(serializeHistoryBounds(all), { start: null, end: null })
  assert.equal(isHistoryTimestampInRange(Date.parse("1850-01-01"), all), true)
  assert.equal(isHistoryTimestampInRange(0, all), true)
  for (const undated of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(isHistoryTimestampInRange(undated, all), false)
  }
  assert.deepEqual(resolveHistoryPeriod("all", { coverage: { startMs: -1000, endMs: null } }), {
    startMs: -1000, endMs: null,
  })
  const coverage = resolveHistoryPeriod(custom("1960-01-01", "2020-01-31"))
  assert.deepEqual(resolveHistoryPeriod("all", { coverage }), coverage)
  assert.deepEqual(historyPeriodDates("all", { coverage }), { from: "1960-01-01", through: "2020-01-31" })
  assert.throws(() => resolveHistoryPeriod("all", { coverage: { startMs: -Infinity, endMs: Infinity } }), RangeError)
  assert.throws(() => historyPeriodDates("all", { coverage: { startMs: 0, endMs: 0 } }), RangeError)
})

test("URL roundtrips preserve arbitrary dates and reject malformed or reversed links", () => {
  for (const value of ["today", "7d", "30d", "90d", "180d", "ytd", "all", custom("1945-01-01", "2025-12-31")] as HistoryPeriod[]) {
    const params = new URLSearchParams({ period: serializeHistoryPeriod(value), tab: "history" })
    assert.deepEqual(parseHistoryPeriod(new URLSearchParams(params.toString()).get("period")), value)
    assert.equal(params.get("tab"), "history")
  }
  for (const value of [null, undefined, "", "10y", "custom:2025-02-30:2025-03-01", "custom:2025-02-02:2025-01-01", "custom:2025-01-01:2025-01-02:extra"]) {
    assert.equal(parseHistoryPeriod(value), null)
  }
})

test("previous comparison periods keep equal calendar-day counts across DST and reject open periods", () => {
  const current = resolveHistoryPeriod(custom("2024-03-10"), { timeZone: "America/New_York" })
  const previous = previousHistoryPeriod(current, "America/New_York")!
  assert.equal(iso(previous.startMs), "2024-03-09T05:00:00.000Z")
  assert.equal(previous.endMs, current.startMs)
  assert.equal(previous.endMs! - previous.startMs!, 24 * 60 * 60 * 1000)
  assert.equal(previousHistoryPeriod({ startMs: null, endMs: null }), null)
  assert.equal(previousHistoryPeriod({ startMs: null, endMs: 100 }), null)
  assert.equal(previousHistoryPeriod({ startMs: 100, endMs: 100 }), null)
})

test("adaptive chart buckets cover the full selected interval exactly, including decades", () => {
  for (const [from, through, maximum] of [["2024-03-01", "2024-04-30", 10], ["1940-06-01", "2025-09-30", 24], ["0001-01-01", "9999-12-31", 20], ["1969-12-15", "1970-02-15", 1]] as const) {
    const bounds = resolveHistoryPeriod(custom(from, through))
    const buckets = createHistoryBuckets(bounds, { maxBuckets: maximum })
    assert.ok(buckets.length > 0 && buckets.length <= maximum)
    assert.equal(buckets[0]!.startMs, bounds.startMs)
    assert.equal(buckets.at(-1)!.endMs, bounds.endMs)
    for (let index = 1; index < buckets.length; index++) {
      assert.equal(buckets[index]!.startMs, buckets[index - 1]!.endMs)
    }
  }
  assert.deepEqual(createHistoryBuckets({ startMs: null, endMs: null }), [])
})

test("daily chart buckets retain DST boundaries and a single owner for each timestamp", () => {
  const bounds = resolveHistoryPeriod(custom("2024-03-09", "2024-03-11"), { timeZone: "America/New_York" })
  const buckets = createHistoryBuckets(bounds, { timeZone: "America/New_York" })
  assert.equal(buckets.length, 3)
  assert.equal(buckets[1]!.endMs - buckets[1]!.startMs, 23 * 60 * 60 * 1000)
  assert.equal(historyDateAt(buckets[1]!.startMs, "America/New_York"), "2024-03-10")
  assert.equal(buckets.filter((bucket) => isHistoryTimestampInRange(buckets[1]!.startMs, bucket)).length, 1)
})

test("a negative fractional millisecond remains in a pre1970 bucket with the matching label", () => {
  const bounds = { startMs: -0.001, endMs: 0 }
  const buckets = createHistoryBuckets(bounds)
  assert.equal(historyDateAt(-0.001), "1969-12-31")
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0]!.key, "day:1969-12-31")
  assert.equal(buckets[0]!.label, "Dec 31, 1969")
  assert.equal(isHistoryTimestampInRange(-0.001, buckets[0]!), true)
  assert.deepEqual({ startMs: buckets[0]!.startMs, endMs: buckets[0]!.endMs }, bounds)
})
