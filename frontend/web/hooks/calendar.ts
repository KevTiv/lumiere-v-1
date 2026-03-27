/**
 * Calendar hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Calendar module.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Reads ─────────────────────────────────────────────────────────────────────

export function useCalendarEvents(
  organizationId: bigint,
  initialData?: Record<string, unknown>[],
) {
  return useQuery({
    queryKey: ['calendar-events', organizationId.toString()],
    queryFn: async () => {
      const r = await fetch('/api/query/calendar-events')
      if (!r.ok) throw new Error('Failed to fetch calendar events')
      const json = await r.json()
      return (json.data ?? []) as Record<string, unknown>[]
    },
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateCalendarEvent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await fetch('/api/call/create_calendar_event', {
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

// ── Types (re-exported so client components import from one place) ────────────
export type { CreateCalendarEventParams } from '@lumiere/stdb'
