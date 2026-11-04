import { describe, expect, it } from "vitest"
import { calendarDate, calendarDayKey, calendarEventOccursOnDay, calendarEventsForDay, calendarMode, calendarPeriodDays, shiftCalendarDate } from "./calendar-dates"
import type { CalendarEvent } from "./calendar-types"

const event = (id: string, startTime: Date, endTime: Date, allDay = false): CalendarEvent => ({ id, startTime, endTime, allDay, title: id, type: "meeting", status: "confirmed", visibility: "private", attendees: [], createdBy: "" })

describe("calendar dates and visible intervals", () => {
  it("validates URL dates and view modes without rolling invalid days into another month", () => {
    const fallback = new Date(2026, 9, 28)
    expect(calendarDayKey(calendarDate("2026-02-30", fallback))).toBe("2026-10-28")
    expect(calendarDayKey(calendarDate("2026-02-28", fallback))).toBe("2026-02-28")
    expect(calendarMode("week")).toBe("week")
    expect(calendarMode("unknown")).toBe("agenda")
    expect(calendarPeriodDays("month", new Date(2028, 1, 12))).toHaveLength(29)
    expect(calendarPeriodDays("week", fallback)[0]!.getDay()).toBe(0)
    expect(calendarPeriodDays("day", fallback)).toHaveLength(1)
  })

  it("shows cross-midnight and multi-day intervals on every occupied date, with an exclusive midnight end", () => {
    const overnight = event("overnight", new Date(2026, 9, 28, 23), new Date(2026, 9, 30, 0))
    expect(calendarEventOccursOnDay(overnight, new Date(2026, 9, 27))).toBe(false)
    expect(calendarEventOccursOnDay(overnight, new Date(2026, 9, 28))).toBe(true)
    expect(calendarEventOccursOnDay(overnight, new Date(2026, 9, 29))).toBe(true)
    expect(calendarEventOccursOnDay(overnight, new Date(2026, 9, 30))).toBe(false)
    const zero = event("zero", new Date(2026, 9, 28), new Date(2026, 9, 28), true)
    expect(calendarEventOccursOnDay(zero, new Date(2026, 9, 28))).toBe(true)
    expect(calendarEventOccursOnDay(event("invalid", new Date("invalid"), new Date()), new Date())).toBe(false)
  })

  it("orders all-day events before timed events and keeps cancellation visible", () => {
    const day = new Date(2026, 9, 28)
    const rows = [event("later", new Date(2026, 9, 28, 15), new Date(2026, 9, 28, 16)), { ...event("cancelled", new Date(2026, 9, 28, 10), new Date(2026, 9, 28, 11)), status: "cancelled" as const }, event("all-day", day, day, true)]
    expect(calendarEventsForDay(rows, day).map((row) => row.id)).toEqual(["all-day", "cancelled", "later"])
  })

  it("advances by calendar dates across daylight-saving transitions", () => {
    const originalTimezone = process.env.TZ
    process.env.TZ = "Europe/Amsterdam"
    try {
      const saturday = new Date(2026, 9, 24)
      const monday = shiftCalendarDate(saturday, 2)
      expect(calendarDayKey(monday)).toBe("2026-10-26")
      expect(monday.getHours()).toBe(0)
      expect(monday.getTime() - saturday.getTime()).toBe(49 * 60 * 60 * 1000)
    } finally {
      process.env.TZ = originalTimezone
    }
  })
})


it("groups UTC instants by account-zone occupied dates, including short and long DST days", () => {
  const zone = "Europe/Amsterdam"
  const day = calendarDate("2026-03-29", new Date(), zone)
  expect(calendarDayKey(day, zone)).toBe("2026-03-29")
  expect(shiftCalendarDate(day, 1, zone).getTime() - day.getTime()).toBe(23 * 3_600_000)
  const before = event("before", new Date("2026-03-28T22:00:00Z"), new Date("2026-03-28T23:00:00Z"))
  const overnight = event("overnight", new Date("2026-03-28T23:30:00Z"), new Date("2026-03-29T23:00:00Z"))
  expect(calendarEventOccursOnDay(before, day, zone)).toBe(false)
  expect(calendarEventOccursOnDay(overnight, day, zone)).toBe(true)
  expect(calendarEventsForDay([before, overnight], day, zone).map((row) => row.id)).toEqual(["overnight"])
  const autumn = calendarDate("2026-10-25", new Date(), zone)
  expect(shiftCalendarDate(autumn, 1, zone).getTime() - autumn.getTime()).toBe(25 * 3_600_000)
})
