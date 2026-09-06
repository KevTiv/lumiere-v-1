import { test } from "node:test"
import assert from "node:assert/strict"
import {
  microsToDate,
  millisToDate,
  isoToDate,
  stdbTimestampToDate,
  compatNumberToDate,
  timestampToIso,
} from "./timestamp-values"

test("microsToDate converts microseconds to Date", () => {
  // 1725494400000000 micros = 2024-09-05T00:00:00.000Z
  const d = microsToDate(1725494400000000)
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("microsToDate handles bigint", () => {
  const d = microsToDate(BigInt(1725494400000000))
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("microsToDate returns null for invalid", () => {
  assert.equal(microsToDate(NaN), null)
  assert.equal(microsToDate("abc"), null)
  assert.equal(microsToDate(Infinity), null)
})

test("millisToDate converts milliseconds to Date", () => {
  const d = millisToDate(1725494400000)
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("millisToDate returns null for invalid", () => {
  assert.equal(millisToDate(NaN), null)
  assert.equal(millisToDate("abc"), null)
})

test("isoToDate parses ISO strings", () => {
  const d = isoToDate("2024-09-05T00:00:00.000Z")
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("isoToDate returns null for invalid strings", () => {
  assert.equal(isoToDate("not-a-date"), null)
})

test("stdbTimestampToDate handles microsSinceUnixEpoch (camelCase)", () => {
  const d = stdbTimestampToDate({ microsSinceUnixEpoch: 1725494400000000 })
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("stdbTimestampToDate handles micros_since_unix_epoch (snake_case)", () => {
  const d = stdbTimestampToDate({ micros_since_unix_epoch: 1725494400000000 })
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("stdbTimestampToDate passes through Date objects", () => {
  const date = new Date("2024-09-05T00:00:00.000Z")
  const d = stdbTimestampToDate(date)
  assert.equal(d, date)
})

test("stdbTimestampToDate rejects invalid Date objects", () => {
  assert.equal(stdbTimestampToDate(new Date("invalid")), null)
})

test("stdbTimestampToDate returns null for unrecognized shapes", () => {
  assert.equal(stdbTimestampToDate(null), null)
  assert.equal(stdbTimestampToDate(undefined), null)
  assert.equal(stdbTimestampToDate(123), null)
  assert.equal(stdbTimestampToDate({ foo: 1 }), null)
})

test("compatNumberToDate treats small numbers as milliseconds", () => {
  // 1_000_000_000 ms < 10_000_000_000 threshold → treated as millis
  const d = compatNumberToDate(1_000_000_000)
  assert.ok(d)
  assert.equal(d!.toISOString(), "1970-01-12T13:46:40.000Z")
})

test("compatNumberToDate treats large numbers as microseconds", () => {
  // 1_725_494_400_000_000 micros > 10_000_000_000 threshold → divided by 1000
  const d = compatNumberToDate(1725494400000000)
  assert.ok(d)
  assert.equal(d!.toISOString(), "2024-09-05T00:00:00.000Z")
})

test("compatNumberToDate returns null for invalid", () => {
  assert.equal(compatNumberToDate(null), null)
  assert.equal(compatNumberToDate(""), null)
  assert.equal(compatNumberToDate("abc"), null)
})

test("timestampToIso returns ISO string for STDB timestamp", () => {
  const iso = timestampToIso({ microsSinceUnixEpoch: 1725494400000000 })
  assert.equal(iso, "2024-09-05T00:00:00.000Z")
})

test("timestampToIso returns epoch for null", () => {
  assert.equal(timestampToIso(null), "1970-01-01T00:00:00.000Z")
})

test("timestampToIso returns epoch for empty string", () => {
  assert.equal(timestampToIso(""), "1970-01-01T00:00:00.000Z")
})
