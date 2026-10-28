import type { CalendarEvent, ViewMode } from "./calendar-types"

/** Local calendar dates, deliberately independent of UTC serialization. */
export function calendarDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function calendarDate(value: string | null, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(fallback)
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(year!, month! - 1, day!)
  return calendarDayKey(parsed) === value ? parsed : new Date(fallback)
}

export function calendarMode(value: string | null): ViewMode {
  return value === "month" || value === "week" || value === "day" ? value : "agenda"
}

/** Use calendar arithmetic so a daylight-saving transition remains one date. */
export function shiftCalendarDate(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function calendarPeriodDays(mode: ViewMode, date: Date): Date[] {
  const first = mode === "month"
    ? new Date(date.getFullYear(), date.getMonth(), 1)
    : mode === "week" ? shiftCalendarDate(date, -date.getDay()) : shiftCalendarDate(date, 0)
  const length = mode === "month" ? new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    : mode === "week" ? 7 : mode === "day" ? 1 : 30
  return Array.from({ length }, (_, day) => shiftCalendarDate(first, day))
}

/** Half-open timed intervals; a zero-duration event still occurs on its start date. */
export function calendarEventOccursOnDay(event: Pick<CalendarEvent, "startTime" | "endTime">, day: Date): boolean {
  const start = event.startTime.getTime()
  const stop = event.endTime.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return false
  const dayStart = shiftCalendarDate(day, 0).getTime()
  const dayEnd = shiftCalendarDate(day, 1).getTime()
  return start === stop ? start >= dayStart && start < dayEnd : start < dayEnd && stop > dayStart
}

export function calendarEventsForDay(events: readonly CalendarEvent[], date: Date): CalendarEvent[] {
  return events.filter((event) => calendarEventOccursOnDay(event, date)).sort((a, b) =>
    Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) || a.startTime.getTime() - b.startTime.getTime() || a.id.localeCompare(b.id),
  )
}
