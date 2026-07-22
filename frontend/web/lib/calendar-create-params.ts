/**
 * Maps Calendar module form payloads to SpacetimeDB reducer param types.
 */

import type { CreateCalendarEventParams } from "@lumiere/stdb/types"
import type { Timestamp } from "spacetimedb"

import { optionalTrimmedString } from "@lumiere/erp-shared/form-coercion"

import { stbTimestampFromDate } from "@/lib/stb-timestamp"

function requiredTimestampFromForm(v: unknown): Timestamp | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

export function toCreateCalendarEventParams(
  formData: Record<string, unknown>,
): CreateCalendarEventParams | null {
  const name = String(formData.name ?? "").trim()
  if (!name) return null

  const start = requiredTimestampFromForm(formData.start)
  const stop = requiredTimestampFromForm(formData.stop)
  if (start == null || stop == null) return null

  return {
    name,
    start,
    stop,
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
