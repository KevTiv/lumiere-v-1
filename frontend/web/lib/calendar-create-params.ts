/**
 * Maps Calendar module form payloads to SpacetimeDB reducer param types.
 */

import type { CreateCalendarEventParams } from "@lumiere/stdb/types"

import { optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import { calendarEventFormRange } from "./calendar-event-range"

export function toCreateCalendarEventParams(
  formData: Record<string, unknown>,
  timeZone?: string,
): CreateCalendarEventParams | null {
  const name = String(formData.name ?? "").trim()
  if (!name) return null

  const range = calendarEventFormRange(formData, { timeZone })
  if (!range) return null

  return {
    name,
    start: stbTimestampFromDate(range.start),
    stop: stbTimestampFromDate(range.stop),
    allday: Boolean(formData.allday),
    privacy: String(formData.privacy ?? "public"),
    showAs: "busy",
    state: "confirmed",
    recurrency: false,
    partnerIds: [],
    alarmIds: [],
    userId: undefined,
    description: optionalTrimmedString(formData.description),
    location: optionalTrimmedString(formData.location),
    videocallLocation: undefined,
    color: undefined,
    recurrenceId: undefined,
    rrule: undefined,
    rruleType: undefined,
    finalDate: undefined,
    metadata: undefined,
  }
}
