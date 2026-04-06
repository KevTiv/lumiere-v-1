"use client"

/**
 * Calendar hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Calendar module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useCalendarEvents(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['calendar-events', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/calendar-events', 'Failed to fetch calendar events'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_calendar_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', organizationId.toString()] }),
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
      const r = await apiFetch('/api/call/update_calendar_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), eventId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to update calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', organizationId.toString()] }),
  })
}

export function useDeleteCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, string | number | bigint>({
    mutationFn: async (eventId) => {
      const r = await apiFetch('/api/call/delete_calendar_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), eventId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to delete calendar event')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['calendar-events', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateCalendarEventParams } from '@lumiere/stdb/generated/types'

// Local type until SpacetimeDB bindings are regenerated
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
