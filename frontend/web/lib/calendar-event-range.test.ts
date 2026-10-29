import assert from "node:assert/strict"
import test from "node:test"
import { calendarEventFormRange, localCalendarDate } from "./calendar-event-range"

function inTimezone(zone: string, work: () => void) {
  const previous = process.env.TZ
  process.env.TZ = zone
  try { work() } finally {
    if (previous == null) delete process.env.TZ
    else process.env.TZ = previous
  }
}

test("all-day date inputs cover inclusive dates without shifting the selected local date", () => {
  for (const zone of ["Africa/Kigali", "America/Los_Angeles", "Europe/Amsterdam"]) inTimezone(zone, () => {
    const range = calendarEventFormRange({ allday: true, allDayStart: "2026-10-28", allDayEnd: "2026-10-29" })
    assert.ok(range)
    assert.equal(range.start.getDate(), 28)
    assert.equal(range.start.getHours(), 0)
    assert.equal(range.stop.getDate(), 30)
    assert.equal(range.stop.getHours(), 0)
  })
})

test("all-day ranges use calendar arithmetic across daylight-saving transitions", () => inTimezone("Europe/Amsterdam", () => {
  const spring = calendarEventFormRange({ allday: true, allDayStart: "2026-03-29", allDayEnd: "2026-03-29" })
  const autumn = calendarEventFormRange({ allday: true, allDayStart: "2026-10-25", allDayEnd: "2026-10-25" })
  assert.equal(spring!.stop.getTime() - spring!.start.getTime(), 23 * 3_600_000)
  assert.equal(autumn!.stop.getTime() - autumn!.start.getTime(), 25 * 3_600_000)
  assert.equal(calendarEventFormRange({ start: "2026-03-29T02:30", stop: "2026-03-29T04:00" }), null)
}))

test("unchanged legacy all-day edits preserve exact existing boundaries", () => {
  const common = { allday: true, allDayStart: "2026-10-28", allDayEnd: "2026-10-28", originalAllDayStartDate: "2026-10-28", originalAllDayEndDate: "2026-10-28", originalAllDayStart: "2026-10-28T00:00", originalAllDayStop: "2026-10-28T00:00" }
  const range = calendarEventFormRange(common)
  assert.equal(range!.start.getTime(), range!.stop.getTime())
  const changed = calendarEventFormRange({ ...common, allDayEnd: "2026-10-29" })
  assert.equal(changed!.stop.getDate(), 30)
})

test("invalid dates and reversed all-day ranges cannot reach the reducer", () => {
  assert.equal(localCalendarDate("2026-02-29"), null)
  assert.equal(localCalendarDate("2026-04-31"), null)
  assert.equal(calendarEventFormRange({ allday: true, allDayStart: "2026-10-29", allDayEnd: "2026-10-28" }), null)
  assert.equal(calendarEventFormRange({ allday: true, allDayStart: "2026-10-28" }), null)
})
