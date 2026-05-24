"use client"

/**
 * Calendar hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Calendar module.
 */


import { calendarBffPost } from "@lumiere/stdb/commands"
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { CreateCalendarEventParams } from '@lumiere/stdb/generated/types'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useCalendarEvents(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['calendar-events', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/calendar-events', 'Failed to fetch calendar events'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateCalendarEventParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = calendarBffPost("create_calendar_event", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = calendarBffPost("update_calendar_event", [
        organizationId,
        eventId,
        stdbParamsToJson(params as object),
      ])
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
      const { urlPath, init } = calendarBffPost("delete_calendar_event", [organizationId, eventId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to delete calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', rqBigIntKey(organizationId)] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateCalendarEventParams } from '@lumiere/stdb/generated/types'

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
