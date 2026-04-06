"use client"

/**
 * IoT hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the IoT module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Telemetry (`record_telemetry`, `record_telemetry_batch`): intended callers are the **IoT hub /
 * gateway** (devices → hub → SpacetimeDB). The web UI exposes the same reducers for **admin
 * debugging or demos** only; production ingestion should not rely on browser POST volume.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, type QueryRows } from "../http"

type ScalarId = bigint | number | string

async function parseCallError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

async function postReducer(path: string, body: unknown[]): Promise<void> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await parseCallError(r))
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useIotDevices(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-devices', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-devices', 'Failed to fetch IoT devices'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotHubs(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-hubs', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-hubs', 'Failed to fetch IoT hubs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotPairingTokens(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-pairing-tokens', organizationId.toString()],
    queryFn: () =>
      fetchQueryList('/api/query/iot-pairing-tokens', 'Failed to fetch IoT pairing tokens'),
    staleTime: 15_000,
    initialData,
  })
}

export function useIotAlerts(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-alerts', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-alerts', 'Failed to fetch IoT alerts'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotActions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-actions', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-actions', 'Failed to fetch IoT actions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotTelemetry(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-telemetry', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/iot-telemetry', 'Failed to fetch IoT telemetry'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotThresholds(organizationId: bigint, initialData?: QueryRows) {
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
    qc.invalidateQueries({ queryKey: ['iot-pairing-tokens', org] }),
    qc.invalidateQueries({ queryKey: ['iot-alerts', org] }),
    qc.invalidateQueries({ queryKey: ['iot-actions', org] }),
    qc.invalidateQueries({ queryKey: ['iot-telemetry', org] }),
    qc.invalidateQueries({ queryKey: ['iot-thresholds', org] }),
  ])
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Creates a pairing token row; read the token from {@link useIotPairingTokens}. */
export function useGenerateHubPairingToken(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await postReducer('/api/call/generate_hub_pairing_token?withCompany=true', [])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

/**
 * Simulates hub pairing from the ERP (normally the IoT gateway calls this unauthenticated).
 * Use only for local/dev validation.
 */
export function useClaimHubWithToken(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      token: string
      serial: string
      name: string
      ipAddress?: string | null
      firmwareVersion?: string | null
    }) => {
      await postReducer('/api/call/claim_hub_with_token', [
        args.token,
        args.serial,
        args.name,
        args.ipAddress ?? null,
        args.firmwareVersion ?? null,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRegisterIotHub(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      await postReducer('/api/call/register_iot_hub?withCompany=true', [params])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useDeleteIotHub(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (hubId: ScalarId) => {
      await postReducer('/api/call/delete_iot_hub', [organizationId.toString(), hubId.toString()])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRegisterIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { hubId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ hubId, params }) => {
      await postReducer('/api/call/register_iot_device?withCompany=true', [
        hubId.toString(),
        params,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useDeleteIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      await postReducer('/api/call/delete_iot_device', [organizationId.toString(), deviceId.toString()])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useLinkDeviceToLocation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; locationId: ScalarId }) => {
      await postReducer('/api/call/link_device_to_location', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.locationId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useLinkDeviceToPos(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; posConfigId: ScalarId }) => {
      await postReducer('/api/call/link_device_to_pos', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.posConfigId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useUnlinkDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      await postReducer('/api/call/unlink_device', [organizationId.toString(), deviceId.toString()])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useUpdateHubHeartbeat(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      hubId: ScalarId
      ipAddress?: string | null
      firmwareVersion?: string | null
      connectivityQuality?: string | null
    }) => {
      await postReducer('/api/call/update_hub_heartbeat', [
        organizationId.toString(),
        args.hubId.toString(),
        args.ipAddress ?? null,
        args.firmwareVersion ?? null,
        args.connectivityQuality ?? null,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useSyncHubDevices(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      hubId: ScalarId
      detected: Array<{
        identifier: string
        name: string
        device_type: string
        capabilities: string[]
      }>
    }) => {
      await postReducer('/api/call/sync_hub_devices', [
        organizationId.toString(),
        args.hubId.toString(),
        args.detected,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useUpdateDeviceStatus(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; status: string }) => {
      await postReducer('/api/call/update_device_status', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.status,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export type RecordTelemetryParamsSnake = {
  sensor_type: string
  value: number
  raw_value?: string | null
  unit: string
  quality: string
}

export function useRecordTelemetry(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; params: RecordTelemetryParamsSnake }) => {
      await postReducer('/api/call/record_telemetry', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.params,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRecordTelemetryBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; readings: RecordTelemetryParamsSnake[] }) => {
      await postReducer('/api/call/record_telemetry_batch', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.readings,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useMarkActionSent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      await postReducer('/api/call/mark_action_sent', [
        organizationId.toString(),
        actionId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useCreateIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      deviceId: ScalarId
      action_type: string
      payload: string
      triggered_by: string
    }
  >({
    mutationFn: async (body) => {
      const { deviceId, ...params } = body
      await postReducer('/api/call/create_iot_action', [
        organizationId.toString(),
        deviceId.toString(),
        params,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useAcknowledgeIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      await postReducer('/api/call/acknowledge_iot_action', [
        organizationId.toString(),
        actionId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useFailIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { actionId: ScalarId; reason?: string | null }) => {
      await postReducer('/api/call/fail_iot_action', [
        organizationId.toString(),
        args.actionId.toString(),
        args.reason ?? null,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRetryIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      await postReducer('/api/call/retry_iot_action', [
        organizationId.toString(),
        actionId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useCreateIotAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      deviceId: ScalarId
      alert_type: string
      severity: string
      message: string
    }) => {
      await postReducer('/api/call/create_iot_alert', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.alert_type,
        args.severity,
        args.message,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useResolveIotAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alertId: ScalarId) => {
      await postReducer('/api/call/resolve_iot_alert', [
        organizationId.toString(),
        alertId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useSetIotThreshold(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      deviceId: ScalarId
      sensor_type: string
      min_value: number | null
      max_value: number | null
      severity: string
    }) => {
      await postReducer('/api/call/set_iot_threshold', [
        organizationId.toString(),
        args.deviceId.toString(),
        args.sensor_type,
        args.min_value,
        args.max_value,
        args.severity,
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useTestIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      await postReducer('/api/call/test_iot_device', [
        organizationId.toString(),
        deviceId.toString(),
      ])
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}
