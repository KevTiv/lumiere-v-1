import type { CalendarEvent, ViewMode } from "./calendar-types"
import { zonedCalendarDay, zonedCalendarDayStart, zonedCalendarParts } from "@lumiere/erp-shared/calendar-timezone"

/** Local calendar dates, deliberately independent of UTC serialization. */
export function calendarDayKey(date: Date, timeZone?: string): string {
  if (timeZone) return zonedCalendarDay(date, timeZone)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function calendarDate(value: string | null, fallback: Date, timeZone?: string): Date {
  if (timeZone) return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? zonedCalendarDayStart(value, timeZone) ?? new Date(fallback) : new Date(fallback)
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(fallback)
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(year!, month! - 1, day!)
  return calendarDayKey(parsed) === value ? parsed : new Date(fallback)
}

export function calendarMode(value: string | null): ViewMode {
  return value === "month" || value === "week" || value === "day" ? value : "agenda"
}

/** Use calendar arithmetic so a daylight-saving transition remains one date. */
export function shiftCalendarDate(date: Date, days: number, timeZone?: string): Date {
  if (timeZone) {
    const p = zonedCalendarParts(date, timeZone)
    const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
    return zonedCalendarDayStart(shifted.toISOString().slice(0, 10), timeZone) ?? shifted
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function calendarPeriodDays(mode: ViewMode, date: Date, timeZone?: string): Date[] {
  if (timeZone) {
    const p = zonedCalendarParts(date, timeZone)
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
    const first = mode === "month" ? zonedCalendarDayStart(`${p.year}-${String(p.month).padStart(2, "0")}-01`, timeZone)! : shiftCalendarDate(date, mode === "week" ? -weekday : 0, timeZone)
    const length = mode === "month" ? new Date(Date.UTC(p.year, p.month, 0)).getUTCDate() : mode === "week" ? 7 : mode === "day" ? 1 : 30
    return Array.from({ length }, (_, day) => shiftCalendarDate(first, day, timeZone))
  }
  const first = mode === "month"
    ? new Date(date.getFullYear(), date.getMonth(), 1)
    : mode === "week" ? shiftCalendarDate(date, -date.getDay()) : shiftCalendarDate(date, 0)
  const length = mode === "month" ? new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    : mode === "week" ? 7 : mode === "day" ? 1 : 30
  return Array.from({ length }, (_, day) => shiftCalendarDate(first, day))
}

/** Half-open timed intervals; a zero-duration event still occurs on its start date. */
function occupiesDay(event: Pick<CalendarEvent, "startTime" | "endTime">, dayStart: number, dayEnd: number): boolean {
  const start = event.startTime.getTime()
  const stop = event.endTime.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return false
  return start === stop ? start >= dayStart && start < dayEnd : start < dayEnd && stop > dayStart
}

export function calendarEventOccursOnDay(event: Pick<CalendarEvent, "startTime" | "endTime">, day: Date, timeZone?: string): boolean {
  return occupiesDay(event, shiftCalendarDate(day, 0, timeZone).getTime(), shiftCalendarDate(day, 1, timeZone).getTime())
}

export function calendarEventsForDay(events: readonly CalendarEvent[], date: Date, timeZone?: string): CalendarEvent[] {
  // Resolve the zone boundaries once per displayed day, rather than once per event.
  const dayStart = shiftCalendarDate(date, 0, timeZone).getTime()
  const dayEnd = shiftCalendarDate(date, 1, timeZone).getTime()
  return events.filter((event) => occupiesDay(event, dayStart, dayEnd)).sort((a, b) =>
    Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) || a.startTime.getTime() - b.startTime.getTime() || a.id.localeCompare(b.id),
  )
}

/** Move a month by date components in the chosen calendar, rather than elapsed hours. */
export function shiftCalendarMonth(date: Date, months: number, timeZone: string): Date {
  const p = zonedCalendarParts(date, timeZone)
  const first = new Date(Date.UTC(p.year, p.month - 1 + months, 1))
  return zonedCalendarDayStart(first.toISOString().slice(0, 10), timeZone) ?? first
}
