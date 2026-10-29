"use client"


import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { CalendarEvent, CreateCalendarEventParams } from '@lumiere/stdb/types'

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface CalendarReadScope {
  /** Actor, company and current authorization projection, resolved by the caller. */
  key: string
  enabled: boolean
}

export function calendarProjectionQueryKey(resource: string, organizationId: bigint, scope: CalendarReadScope) {
  return [resource, rqBigIntKey(organizationId), 'calendar-workspace', scope.key] as const
}

export function useCalendarEvents(
  organizationId: bigint,
  initialData?: CalendarEvent[],
  scope?: CalendarReadScope,
) {
  return useQuery({
    queryKey: scope ? calendarProjectionQueryKey('calendar-events', organizationId, scope) : ['calendar-events', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/calendar-events', 'Failed to fetch calendar events'),
    staleTime: 30_000,
    // Unbound SSR rows cannot populate a new actor/company authorization scope.
    initialData: scope ? undefined : initialData,
    enabled: scope?.enabled,
  })
}

/** Calendar views require an HTTP projection, never another scope's subscription-seeded rows. */
export function useCalendarActivities(organizationId: bigint, scope: CalendarReadScope) {
  return useQuery({
    queryKey: calendarProjectionQueryKey('activities', organizationId, scope),
    queryFn: () => fetchQueryList('/api/query/activities', 'Failed to fetch calendar activities'),
    enabled: scope.enabled,
    staleTime: 30_000,
  })
}

export function useCalendarContacts(organizationId: bigint, scope: CalendarReadScope) {
  return useQuery({
    queryKey: calendarProjectionQueryKey('contacts', organizationId, scope),
    queryFn: () => fetchQueryList('/api/query/contacts', 'Failed to fetch calendar attendees'),
    enabled: scope.enabled,
    staleTime: 30_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateCalendarEventParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_calendar_event", { params: stdbParamsToJson(params as object, "CreateCalendarEventParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', rqBigIntKey(organizationId)] }),
  })
}

export function useUpdateCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { eventId: string | number | bigint; params: Record<string, unknown> }
  >({
    mutationFn: async ({ eventId, params }) => {
      const { urlPath, init } = stdbBffCommandPost("update_calendar_event", { eventId: eventId, params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', rqBigIntKey(organizationId)] }),
  })
}

export function useDeleteCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (eventId) => {
      const { urlPath, init } = stdbBffCommandPost("delete_calendar_event", { eventId: eventId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', rqBigIntKey(organizationId)] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateCalendarEventParams, CalendarEvent } from '@lumiere/stdb/types'

// Local type until callers finish moving to generated camelCase timestamp params.
export interface UpdateCalendarEventParams {
  name?: string
  start?: number | bigint
  stop?: number | bigint
  allday?: boolean
  privacy?: string
  show_as?: string
  state?: string
  recurrency?: boolean
  partner_ids?: (number | bigint)[]
  alarm_ids?: (number | bigint)[]
  user_id?: string
  description?: string | null
  location?: string | null
  videocall_location?: string | null
  color?: string | null
  recurrence_id?: number | bigint | null
  rrule?: string | null
  rrule_type?: string | null
  final_date?: number | bigint | null
  metadata?: string | null
}
