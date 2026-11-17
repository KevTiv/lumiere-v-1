import { describe, expect, it } from "vitest"
import { isCalendarRecurrenceRule, visibleCalendarOccurrences } from "./calendar-recurrence"
import type { CalendarEvent } from "./calendar-types"

const recurring: CalendarEvent = {
  id: "7",
  title: "Weekly review",
  startTime: new Date("2026-03-23T08:00:00Z"),
  endTime: new Date("2026-03-23T09:00:00Z"),
  type: "meeting",
  status: "confirmed",
  createdBy: "",
  attendees: [],
  visibility: "public",
  isRecurring: true,
  recurrenceRule: "FREQ=WEEKLY;COUNT=3;BYDAY=MO",
}

describe("visible calendar recurrence", () => {
  it("preserves the local start through DST and opens the original series record", () => {
    const result = visibleCalendarOccurrences(
      [recurring],
      new Date("2026-03-29T22:00:00Z"),
      new Date("2026-04-21T22:00:00Z"),
      "Europe/Amsterdam",
    )
    expect(result.incomplete).toBe(false)
    expect(result.events.map((event) => event.startTime.toISOString())).toEqual([
      "2026-03-23T08:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
      "2026-04-06T07:00:00.000Z",
    ])
    expect(result.events[1]).toMatchObject({ seriesId: "7", endTime: new Date("2026-03-30T08:00:00Z") })
    expect(new Set(result.events.map((event) => event.id)).size).toBe(3)
  })

  it("keeps multi-day all-day boundaries and skips occurrences beyond a UTC cutoff", () => {
    const event = {
      ...recurring,
      allDay: true,
      startTime: new Date("2026-03-21T23:00:00Z"),
      endTime: new Date("2026-03-23T23:00:00Z"),
      recurrenceRule: "RRULE:FREQ=WEEKLY;UNTIL=20260328T230000Z",
    }
    const result = visibleCalendarOccurrences(
      [event],
      new Date("2026-03-29T22:00:00Z"),
      new Date("2026-04-21T22:00:00Z"),
      "Europe/Amsterdam",
    )
    expect(result.incomplete).toBe(false)
    expect(result.events).toHaveLength(2)
    expect(result.events[1]).toMatchObject({
      startTime: new Date("2026-03-28T23:00:00Z"),
      endTime: new Date("2026-03-30T22:00:00Z"),
    })
  })

  it("labels rules it cannot display without inventing additional appointments", () => {
    for (const rule of ["FREQ=SECONDLY", "FREQ=WEEKLY;INTERVAL=0", "FREQ=INVALID", ""]) {
      expect(isCalendarRecurrenceRule(rule)).toBe(false)
      const event = { ...recurring, recurrenceRule: rule }
      expect(visibleCalendarOccurrences(
        [event],
        new Date("2026-03-23T00:00:00Z"),
        new Date("2026-04-23T00:00:00Z"),
        "UTC",
      )).toEqual({ events: [event], incomplete: true })
    }
  })
})
