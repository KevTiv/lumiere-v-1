/**
 * IoT hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the IoT module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from '@/lib/query-fetch'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useIotDevices(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['iot-devices', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-devices', 'Failed to fetch IoT devices'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotHubs(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['iot-hubs', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-hubs', 'Failed to fetch IoT hubs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotAlerts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['iot-alerts', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-alerts', 'Failed to fetch IoT alerts'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotActions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['iot-actions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-actions', 'Failed to fetch IoT actions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotTelemetry(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['iot-telemetry', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-telemetry', 'Failed to fetch IoT telemetry'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotThresholds(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['iot-thresholds', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-thresholds', 'Failed to fetch IoT thresholds'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateIotQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const org = organizationId.toString()
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['iot-devices', org] }),
    qc.invalidateQueries({ queryKey: ['iot-hubs', org] }),
    qc.invalidateQueries({ queryKey: ['iot-alerts', org] }),
    qc.invalidateQueries({ queryKey: ['iot-actions', org] }),
    qc.invalidateQueries({ queryKey: ['iot-telemetry', org] }),
    qc.invalidateQueries({ queryKey: ['iot-thresholds', org] }),
  ])
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useRegisterIotHub(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/register_iot_hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to register IoT hub')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useDeleteIotHub(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (hubId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_iot_hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), hubId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to delete IoT hub')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRegisterIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/register_iot_device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to register IoT device')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useDeleteIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: bigint | number | string) => {
      const r = await fetch('/api/call/delete_iot_device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), deviceId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to delete IoT device')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useCreateIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_iot_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create IoT action')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useAcknowledgeIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: bigint | number | string) => {
      const r = await fetch('/api/call/acknowledge_iot_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), actionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to acknowledge IoT action')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useFailIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { actionId: bigint | number | string; reason?: string }) => {
      const r = await fetch('/api/call/fail_iot_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), args.actionId.toString(), args.reason ?? null]),
      })
      if (!r.ok) throw new Error('Failed to mark IoT action as failed')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRetryIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: bigint | number | string) => {
      const r = await fetch('/api/call/retry_iot_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), actionId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to retry IoT action')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useCreateIotAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_iot_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create IoT alert')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useResolveIotAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alertId: bigint | number | string) => {
      const r = await fetch('/api/call/resolve_iot_alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), alertId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to resolve IoT alert')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useSetIotThreshold(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/set_iot_threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to set IoT threshold')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useTestIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: bigint | number | string) => {
      const r = await fetch('/api/call/test_iot_device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), deviceId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to test IoT device')
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}
