/** Local calendar dates must not be parsed as UTC dates or normalized silently. */
export function localCalendarDate(value: unknown): Date | null {
  const text = String(value ?? "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [year, month, day] = text.split("-").map(Number)
  const date = new Date(year!, month! - 1, day!)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : null
}

function localTimestamp(value: unknown): Date | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return null
  // datetime-local inputs in a DST gap must not silently become a different time.
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(text)
  if (local && (!localCalendarDate(local[1]) || date.getHours() !== Number(local[2]) || date.getMinutes() !== Number(local[3]))) return null
  return date
}

export interface CalendarEventRangeValues {
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

/** Date-only all-day UI uses an inclusive last day; stored intervals stay half-open. */
export function calendarEventFormRange(values: CalendarEventRangeValues): { start: Date; stop: Date } | null {
  if (values.allday === true && (values.allDayStart != null || values.allDayEnd != null)) {
    const start = localCalendarDate(values.allDayStart)
    const end = localCalendarDate(values.allDayEnd)
    if (!start || !end || end.getTime() < start.getTime()) return null
    // Preserve existing equal-time and other legacy all-day boundaries on unchanged edits.
    if (values.allDayStart === values.originalAllDayStartDate && values.allDayEnd === values.originalAllDayEndDate) {
      const originalStart = localTimestamp(values.originalAllDayStart)
      const originalStop = localTimestamp(values.originalAllDayStop)
      if (originalStart && originalStop && originalStop.getTime() >= originalStart.getTime()) return { start: originalStart, stop: originalStop }
    }
    const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
    return { start, stop }
  }
  const start = localTimestamp(values.start)
  const stop = localTimestamp(values.stop)
  return start && stop && stop.getTime() >= start.getTime() ? { start, stop } : null
}
