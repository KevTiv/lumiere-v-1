import { parseZonedCalendarInput, zonedCalendarDayStart, validCalendarTimezone } from "@lumiere/erp-shared/calendar-timezone"
/** Local calendar dates must not be parsed as UTC dates or normalized silently. */
export function localCalendarDate(value: unknown): Date | null {
  const text = String(value ?? "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [year, month, day] = text.split("-").map(Number)
  const date = new Date(year!, month! - 1, day!)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : null
}

function localTimestamp(value: unknown, timeZone?: string, original?: Date): Date | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  if (timeZone && /^\d{4}-\d{2}-\d{2}T/.test(text) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) return parseZonedCalendarInput(text, timeZone, original)
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return null
  // datetime-local inputs in a DST gap must not silently become a different time.
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(text)
  if (local && (!localCalendarDate(local[1]) || date.getHours() !== Number(local[2]) || date.getMinutes() !== Number(local[3]))) return null
  return date
}

export interface CalendarEventRangeValues {
  eventTimezone?: unknown
  start?: unknown
  stop?: unknown
  allday?: unknown
  allDayStart?: unknown
  allDayEnd?: unknown
  originalAllDayStartDate?: unknown
  originalAllDayEndDate?: unknown
  originalAllDayStart?: unknown
  originalAllDayStop?: unknown
}

export interface CalendarEventRangeOptions {
  timeZone?: string
  originalStart?: Date
  originalStop?: Date
}

/** Date-only all-day UI uses an inclusive last day; stored intervals stay half-open. */
export function calendarEventFormRange(values: CalendarEventRangeValues, options: CalendarEventRangeOptions = {}): { start: Date; stop: Date } | null {
  const requestedZone = values.eventTimezone ?? options.timeZone
  if (requestedZone != null) {
    const timeZone = validCalendarTimezone(requestedZone)
    if (!timeZone) return null
    options = { ...options, timeZone }
  }
  if (values.allday === true && (values.allDayStart != null || values.allDayEnd != null)) {
    const start = options.timeZone ? zonedCalendarDayStart(String(values.allDayStart), options.timeZone) : localCalendarDate(values.allDayStart)
    const end = options.timeZone ? zonedCalendarDayStart(String(values.allDayEnd), options.timeZone) : localCalendarDate(values.allDayEnd)
    if (!start || !end || end.getTime() < start.getTime()) return null
    // Preserve existing equal-time and other legacy all-day boundaries on unchanged edits.
    if (values.allDayStart === values.originalAllDayStartDate && values.allDayEnd === values.originalAllDayEndDate) {
      const originalStart = options.originalStart ?? localTimestamp(values.originalAllDayStart, options.timeZone)
      const originalStop = options.originalStop ?? localTimestamp(values.originalAllDayStop, options.timeZone)
      if (originalStart && originalStop && originalStop.getTime() >= originalStart.getTime()) return { start: originalStart, stop: originalStop }
    }
    const next = new Date(`${String(values.allDayEnd)}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    const stop = options.timeZone ? zonedCalendarDayStart(next.toISOString().slice(0, 10), options.timeZone) : new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
    return stop ? { start, stop } : null
  }
  const start = localTimestamp(values.start, options.timeZone, options.originalStart)
  const stop = localTimestamp(values.stop, options.timeZone, options.originalStop)
  return start && stop && stop.getTime() >= start.getTime() ? { start, stop } : null
}
