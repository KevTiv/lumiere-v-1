import assert from "node:assert/strict"
import test from "node:test"
import { toCreateCalendarEventParams } from "./calendar-create-params"

test("calendar creation rejects a reversed range without inventing dates", () => {
  assert.equal(toCreateCalendarEventParams({ name: "Review", start: "2026-10-06T10:00", stop: "2026-10-06T09:00" }), null)
  assert.equal(toCreateCalendarEventParams({ name: "Review", start: "no date", stop: "2026-10-06T09:00" }), null)
})

test("calendar creation keeps accepted equal-time all-day semantics and submitted defaults", () => {
  const params = toCreateCalendarEventParams({ name: " Company day ", start: "2026-10-06T00:00", stop: "2026-10-06T00:00", allday: true, privacy: "private", location: "Main office" })
  assert.equal(params?.name, "Company day")
  assert.equal(params?.allday, true)
  assert.deepEqual(params?.start, params?.stop)
  assert.equal(params?.privacy, "private")
  assert.equal(params?.location, "Main office")
  assert.equal(params?.state, "confirmed")
  assert.deepEqual(params?.partnerIds, [])
})

test("date-only all-day creation uses the chosen local dates and excludes hidden timed fields", () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = "Africa/Kigali"
  try {
    const params = toCreateCalendarEventParams({ name: "Office closed", allday: true, allDayStart: "2026-10-28", allDayEnd: "2026-10-28", start: "", stop: "" })
    assert.equal(params?.start.microsSinceUnixEpoch, BigInt(new Date(2026, 9, 28).getTime()) * 1000n)
    assert.equal(params?.stop.microsSinceUnixEpoch, BigInt(new Date(2026, 9, 29).getTime()) * 1000n)
    assert.equal(params?.allday, true)
  } finally {
    if (previousTimezone == null) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})
