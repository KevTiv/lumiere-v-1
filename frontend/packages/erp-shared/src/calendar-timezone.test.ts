import assert from "node:assert/strict"
import test from "node:test"
import { parseZonedCalendarInput, resolveCalendarTimezone, validCalendarTimezone, zonedCalendarDay, zonedCalendarDayStart, zonedCalendarInput } from "./calendar-timezone"

test("account IANA timezone precedes browser, with explicit invalid/missing fallback", () => {
  assert.deepEqual(resolveCalendarTimezone("Africa/Kigali", "America/New_York"), { timeZone: "Africa/Kigali", source: "account", invalidAccount: false })
  assert.deepEqual(resolveCalendarTimezone("Invalid/Zone", "Europe/Amsterdam"), { timeZone: "Europe/Amsterdam", source: "browser", invalidAccount: true })
  assert.equal(resolveCalendarTimezone(undefined, "Invalid/Zone").source, "utc")
  assert.equal(validCalendarTimezone(" Europe/Amsterdam "), "Europe/Amsterdam")
  assert.equal(validCalendarTimezone(""), null)
})

test("spring-forward gaps reject and autumn repeated times choose earlier occurrence", () => {
  assert.equal(parseZonedCalendarInput("2026-03-29T02:30", "Europe/Amsterdam"), null)
  assert.equal(parseZonedCalendarInput("2026-03-29T03:30", "Europe/Amsterdam")?.toISOString(), "2026-03-29T01:30:00.000Z")
  assert.equal(parseZonedCalendarInput("2026-10-25T02:30", "Europe/Amsterdam")?.toISOString(), "2026-10-25T00:30:00.000Z")
  const later = new Date("2026-10-25T01:30:00Z")
  assert.equal(parseZonedCalendarInput(zonedCalendarInput(later, "Europe/Amsterdam"), "Europe/Amsterdam", later)?.getTime(), later.getTime())
  assert.equal(parseZonedCalendarInput("2026-10-25T02:30:20", "Europe/Amsterdam", new Date("2026-10-25T01:30:10Z"))?.toISOString(), "2026-10-25T00:30:20.000Z")
})

test("chosen-zone dates and day boundaries remain correct independently of host timezone", () => {
  const instant = new Date("2026-11-03T01:00:00Z")
  assert.equal(zonedCalendarDay(instant, "America/Los_Angeles"), "2026-11-02")
  assert.equal(zonedCalendarDay(instant, "Africa/Kigali"), "2026-11-03")
  const duration = (a: string, b: string) => zonedCalendarDayStart(b, "Europe/Amsterdam")!.getTime() - zonedCalendarDayStart(a, "Europe/Amsterdam")!.getTime()
  assert.equal(duration("2026-03-29", "2026-03-30"), 23 * 3_600_000)
  assert.equal(duration("2026-10-25", "2026-10-26"), 25 * 3_600_000)
  assert.equal(parseZonedCalendarInput("2026-02-30T10:00", "UTC"), null)
  assert.equal(parseZonedCalendarInput("2026-03-01T24:00", "UTC"), null)
})
