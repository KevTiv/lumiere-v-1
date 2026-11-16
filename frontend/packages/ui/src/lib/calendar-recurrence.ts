import {
  parseZonedCalendarInput,
  zonedCalendarParts,
} from "@lumiere/erp-shared/calendar-timezone"
import * as recurrence from "rrule"
import type { CalendarEvent } from "./calendar-types"

// Node uses the package's CommonJS build, while bundlers can select its ESM build.
const commonJsExports = Reflect.get(recurrence, "default") as typeof recurrence | undefined
const { RRule } = commonJsExports ?? recurrence

const MAX_OCCURRENCES_PER_EVENT = 500
const DAY_MS = 86_400_000

// RRule's UTC fields represent local wall time here. Conversion happens in the
// same IANA timezone as Calendar, independently of the browser's timezone.
function floatingDate(date: Date, timeZone: string): Date {
  const { year, month, day, hour, minute, second } = zonedCalendarParts(date, timeZone)
  const result = new Date(0)
  result.setUTCFullYear(year, month - 1, day)
  result.setUTCHours(hour, minute, second, 0)
  return result
}

function schedule(rule: string) {
  const text = rule.trim().toUpperCase()
  // DTSTART is the saved event's start. The field accepts a single RRULE.
  if (!/^(?:RRULE:)?[A-Z0-9=;,+-]+$/.test(text)) return null
  try {
    const options = RRule.parseString(text)
    if (
      options.freq == null ||
      options.freq > RRule.DAILY ||
      (options.interval != null && (!Number.isSafeInteger(options.interval) || options.interval < 1)) ||
      (options.count != null && (!Number.isSafeInteger(options.count) || options.count < 1))
    ) return null
    return { options, utcUntil: /(?:^|;)UNTIL=[0-9]{8}T[0-9]{6}Z(?:;|$)/.test(text) }
  } catch {
    return null
  }
}

export function isCalendarRecurrenceRule(rule: string): boolean {
  return schedule(rule) != null
}

export function visibleCalendarOccurrences(
  events: readonly CalendarEvent[],
  from: Date,
  to: Date,
  timeZone: string,
): { events: CalendarEvent[]; incomplete: boolean } {
  const result = [...events]
  let incomplete = false
  const windowEnd = floatingDate(to, timeZone)
  for (const event of events) {
    if (!event.isRecurring) continue
    const parsed = event.recurrenceRule ? schedule(event.recurrenceRule) : null
    if (!parsed) {
      incomplete = true
      continue
    }

    const start = floatingDate(event.startTime, timeZone)
    const end = floatingDate(event.endTime, timeZone)
    const duration = event.endTime.getTime() - event.startTime.getTime()
    const daySpan = Math.round((end.getTime() - start.getTime()) / DAY_MS)
    const lookback = event.allDay ? Math.max(1, daySpan) * DAY_MS : duration + DAY_MS
    const windowStart = floatingDate(new Date(from.getTime() - lookback), timeZone)
    const { options, utcUntil } = parsed

    try {
      const rule = new RRule({
        ...options,
        dtstart: start,
        until: utcUntil && options.until ? floatingDate(options.until, timeZone) : options.until,
      })
      const optionsInRange = rule.between(windowStart, windowEnd, true, (_date, index) => {
        if (index < MAX_OCCURRENCES_PER_EVENT) return true
        incomplete = true
        return false
      })
      for (const occurrence of optionsInRange) {
        if (occurrence.getTime() <= start.getTime()) continue
        const startTime = parseZonedCalendarInput(occurrence.toISOString().slice(0, 19), timeZone)
        if (!startTime || startTime >= to) continue
        const allDayEnd = new Date(occurrence.getTime() + daySpan * DAY_MS)
        const endTime = event.allDay
          ? parseZonedCalendarInput(allDayEnd.toISOString().slice(0, 19), timeZone)
          : new Date(startTime.getTime() + duration)
        if (!endTime || endTime < from || (endTime.getTime() === from.getTime() && duration !== 0)) continue
        result.push({
          ...event,
          id: `${event.id}@${startTime.getTime()}`,
          seriesId: event.id,
          startTime,
          endTime,
        })
      }
    } catch {
      incomplete = true
    }
  }
  return { events: result, incomplete }
}
