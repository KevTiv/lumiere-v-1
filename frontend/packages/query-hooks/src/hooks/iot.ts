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

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { iotBffPost } from "@lumiere/stdb/commands"
import { toCreateActionParams } from "@lumiere/erp-shared/iot-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { i18n } from "@lumiere/i18n"

type ScalarId = bigint | number | string

async function parseCallError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string }
    return j.error ?? r.statusText
  } catch {
    return r.statusText
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useIotDevices(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-devices', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/iot-devices', 'Failed to fetch IoT devices'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotHubs(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-hubs', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/iot-hubs', 'Failed to fetch IoT hubs'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotPairingTokens(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-pairing-tokens', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/iot-pairing-tokens', 'Failed to fetch IoT pairing tokens'),
    staleTime: 15_000,
    initialData,
  })
}

export function useIotAlerts(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-alerts', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/iot-alerts', 'Failed to fetch IoT alerts'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotActions(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-actions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/iot-actions', 'Failed to fetch IoT actions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotTelemetry(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-telemetry', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/iot-telemetry', 'Failed to fetch IoT telemetry'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIotThresholds(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['iot-thresholds', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/iot-thresholds', 'Failed to fetch IoT thresholds'),
    staleTime: 30_000,
    initialData,
  })
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateIotQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const k = rqBigIntKey(organizationId)
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['iot-devices', k] }),
    qc.invalidateQueries({ queryKey: ['iot-hubs', k] }),
    qc.invalidateQueries({ queryKey: ['iot-pairing-tokens', k] }),
    qc.invalidateQueries({ queryKey: ['iot-alerts', k] }),
    qc.invalidateQueries({ queryKey: ['iot-actions', k] }),
    qc.invalidateQueries({ queryKey: ['iot-telemetry', k] }),
    qc.invalidateQueries({ queryKey: ['iot-thresholds', k] }),
  ])
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Creates a pairing token row; read the token from {@link useIotPairingTokens}. */
export function useGenerateHubPairingToken(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = iotBffPost("generate_hub_pairing_token", [])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("claim_hub_with_token", [
        args.token,
        args.serial,
        args.name,
        args.ipAddress ?? null,
        args.firmwareVersion ?? null,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRegisterIotHub(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = iotBffPost("register_iot_hub", [
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useDeleteIotHub(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (hubId: ScalarId) => {
      const { urlPath, init } = iotBffPost("delete_iot_hub", [organizationId, hubId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("register_iot_device", [
        hubId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useDeleteIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      const { urlPath, init } = iotBffPost("delete_iot_device", [organizationId, deviceId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useLinkDeviceToLocation(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; locationId: ScalarId }) => {
      const { urlPath, init } = iotBffPost("link_device_to_location", [
        organizationId,
        args.deviceId,
        args.locationId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useLinkDeviceToPos(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; posConfigId: ScalarId }) => {
      const { urlPath, init } = iotBffPost("link_device_to_pos", [
        organizationId,
        args.deviceId,
        args.posConfigId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useUnlinkDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      const { urlPath, init } = iotBffPost("unlink_device", [organizationId, deviceId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("update_hub_heartbeat", [
        organizationId,
        args.hubId,
        args.ipAddress ?? null,
        args.firmwareVersion ?? null,
        args.connectivityQuality ?? null,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("sync_hub_devices", [
        organizationId,
        args.hubId,
        stdbParamsToJson(args.detected as unknown as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useUpdateDeviceStatus(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; status: string }) => {
      const { urlPath, init } = iotBffPost("update_device_status", [
        organizationId,
        args.deviceId,
        args.status,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("record_telemetry", [
        organizationId,
        args.deviceId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRecordTelemetryBatch(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; readings: RecordTelemetryParamsSnake[] }) => {
      const { urlPath, init } = iotBffPost("record_telemetry_batch", [
        organizationId,
        args.deviceId,
        stdbParamsToJson(args.readings as unknown as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useMarkActionSent(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      const { urlPath, init } = iotBffPost("mark_action_sent", [
        organizationId,
        actionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { deviceId, action_type, payload, triggered_by } = body
      const params = toCreateActionParams({
        actionType: action_type,
        action_type,
        payload,
        triggeredBy: triggered_by,
        triggered_by,
      })
      if (!params) throw new Error(i18n.t("common.paramsMapper.invalidIotAction"))
      const { urlPath, init } = iotBffPost("create_iot_action", [
        organizationId,
        deviceId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useAcknowledgeIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      const { urlPath, init } = iotBffPost("acknowledge_iot_action", [
        organizationId,
        actionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useFailIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { actionId: ScalarId; reason?: string | null }) => {
      const { urlPath, init } = iotBffPost("fail_iot_action", [
        organizationId,
        args.actionId,
        args.reason ?? null,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useRetryIotAction(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      const { urlPath, init } = iotBffPost("retry_iot_action", [
        organizationId,
        actionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("create_iot_alert", [
        organizationId,
        args.deviceId,
        args.alert_type,
        args.severity,
        args.message,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useResolveIotAlert(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alertId: ScalarId) => {
      const { urlPath, init } = iotBffPost("resolve_iot_alert", [
        organizationId,
        alertId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
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
      const { urlPath, init } = iotBffPost("set_iot_threshold", [
        organizationId,
        args.deviceId,
        args.sensor_type,
        args.min_value,
        args.max_value,
        args.severity,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}

export function useTestIotDevice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      const { urlPath, init } = iotBffPost("test_iot_device", [
        organizationId,
        deviceId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  })
}
