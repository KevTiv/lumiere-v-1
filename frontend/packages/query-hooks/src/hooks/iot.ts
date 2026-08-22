'use client';

import { stdbBffCommandPost } from '@lumiere/stdb/commands';
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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch, fetchQueryList, rqBigIntKey } from '../http';
import { toCreateActionParams } from '@lumiere/erp-shared/iot-create-params';
import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';
import { i18n } from '@lumiere/i18n';
import type {
  IoTAction,
  IoTAlert,
  IoTDevice,
  IoTHub,
  IoTPairingToken,
  IoTTelemetry,
  IoTThreshold,
} from '@lumiere/stdb/types';

type ScalarId = bigint | number | string;

import { responseErrorMessage as parseCallError } from '@lumiere/api-client/response-error';

// ── Reads ────────────────────────────────────────────────────────────────────

export function useIotDevices(organizationId: bigint, initialData?: IoTDevice[]) {
  return useQuery<IoTDevice[]>({
    queryKey: ['iot-devices', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/iot-devices', 'Failed to fetch IoT devices'),
    staleTime: 30_000,
    initialData,
  });
}

export function useIotHubs(organizationId: bigint, initialData?: IoTHub[]) {
  return useQuery<IoTHub[]>({
    queryKey: ['iot-hubs', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/iot-hubs', 'Failed to fetch IoT hubs'),
    staleTime: 30_000,
    initialData,
  });
}

export function useIotPairingTokens(
  organizationId: bigint,
  initialData?: IoTPairingToken[],
) {
  return useQuery<IoTPairingToken[]>({
    queryKey: ['iot-pairing-tokens', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/iot-pairing-tokens',
        'Failed to fetch IoT pairing tokens',
      ),
    staleTime: 15_000,
    initialData,
  });
}

export function useIotAlerts(organizationId: bigint, initialData?: IoTAlert[]) {
  return useQuery<IoTAlert[]>({
    queryKey: ['iot-alerts', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/iot-alerts', 'Failed to fetch IoT alerts'),
    staleTime: 30_000,
    initialData,
  });
}

export function useIotActions(organizationId: bigint, initialData?: IoTAction[]) {
  return useQuery<IoTAction[]>({
    queryKey: ['iot-actions', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/iot-actions', 'Failed to fetch IoT actions'),
    staleTime: 30_000,
    initialData,
  });
}

export function useIotTelemetry(
  organizationId: bigint,
  initialData?: IoTTelemetry[],
) {
  return useQuery<IoTTelemetry[]>({
    queryKey: ['iot-telemetry', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/iot-telemetry',
        'Failed to fetch IoT telemetry',
      ),
    staleTime: 30_000,
    initialData,
  });
}

export function useIotThresholds(
  organizationId: bigint,
  initialData?: IoTThreshold[],
) {
  return useQuery<IoTThreshold[]>({
    queryKey: ['iot-thresholds', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/iot-thresholds',
        'Failed to fetch IoT thresholds',
      ),
    staleTime: 30_000,
    initialData,
  });
}

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateIotQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const k = rqBigIntKey(organizationId);
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['iot-devices', k] }),
    qc.invalidateQueries({ queryKey: ['iot-hubs', k] }),
    qc.invalidateQueries({ queryKey: ['iot-pairing-tokens', k] }),
    qc.invalidateQueries({ queryKey: ['iot-alerts', k] }),
    qc.invalidateQueries({ queryKey: ['iot-actions', k] }),
    qc.invalidateQueries({ queryKey: ['iot-telemetry', k] }),
    qc.invalidateQueries({ queryKey: ['iot-thresholds', k] }),
  ]);
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Creates a pairing token row; read the token from {@link useIotPairingTokens}. */
export function useGenerateHubPairingToken(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost(
        'generate_hub_pairing_token',
        { companyId },
      );
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

/**
 * Simulates hub pairing from the ERP (normally the IoT gateway calls this unauthenticated).
 * Use only for local/dev validation.
 */
export function useClaimHubWithToken(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      token: string;
      serial: string;
      name: string;
      ipAddress?: string | null;
      firmwareVersion?: string | null;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('claim_hub_with_token', {
        token: args.token,
        serial: args.serial,
        name: args.name,
        ipAddress: args.ipAddress ?? null,
        firmwareVersion: args.firmwareVersion ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useRegisterIotHub(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient();
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('register_iot_hub', {
        companyId,
        params: stdbParamsToJson(params as object, 'RegisterHubParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useDeleteIotHub(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hubId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_iot_hub', {
        hubId: hubId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useRegisterIotDevice(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { hubId: ScalarId; params: Record<string, unknown> }
  >({
    mutationFn: async ({ hubId, params }) => {
      if (companyId == null || companyId <= 0n)
        throw new Error('A selected company is required');
      const { urlPath, init } = stdbBffCommandPost('register_iot_device', {
        companyId,
        hubId,
        params: stdbParamsToJson(params as object, 'RegisterDeviceParams'),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useDeleteIotDevice(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('delete_iot_device', {
        deviceId: deviceId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useLinkDeviceToLocation(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; locationId: ScalarId }) => {
      const { urlPath, init } = stdbBffCommandPost('link_device_to_location', {
        deviceId: args.deviceId,
        locationId: args.locationId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useLinkDeviceToPos(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; posConfigId: ScalarId }) => {
      const { urlPath, init } = stdbBffCommandPost('link_device_to_pos', {
        deviceId: args.deviceId,
        posConfigId: args.posConfigId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useUnlinkDevice(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('unlink_device', {
        deviceId: deviceId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useUpdateHubHeartbeat(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      hubId: ScalarId;
      ipAddress?: string | null;
      firmwareVersion?: string | null;
      connectivityQuality?: string | null;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('update_hub_heartbeat', {
        hubId: args.hubId,
        ipAddress: args.ipAddress ?? null,
        firmwareVersion: args.firmwareVersion ?? null,
        connectivityQuality: args.connectivityQuality ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useSyncHubDevices(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      hubId: ScalarId;
      detected: Array<{
        identifier: string;
        name: string;
        device_type: string;
        capabilities: string[];
      }>;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('sync_hub_devices', {
        hubId: args.hubId,
        detected: stdbParamsToJson(args.detected as unknown as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useUpdateDeviceStatus(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { deviceId: ScalarId; status: string }) => {
      const { urlPath, init } = stdbBffCommandPost('update_device_status', {
        deviceId: args.deviceId,
        status: args.status,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export type RecordTelemetryParamsSnake = {
  sensor_type: string;
  value: number;
  raw_value?: string | null;
  unit: string;
  quality: string;
};

export function useRecordTelemetry(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      deviceId: ScalarId;
      params: RecordTelemetryParamsSnake;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('record_telemetry', {
        deviceId: args.deviceId,
        params: stdbParamsToJson(args.params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useRecordTelemetryBatch(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      deviceId: ScalarId;
      readings: RecordTelemetryParamsSnake[];
    }) => {
      const { urlPath, init } = stdbBffCommandPost('record_telemetry_batch', {
        deviceId: args.deviceId,
        readings: stdbParamsToJson(args.readings as unknown as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useMarkActionSent(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('mark_action_sent', {
        actionId: actionId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useCreateIotAction(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      deviceId: ScalarId;
      action_type: string;
      payload: string;
      triggered_by: string;
    }
  >({
    mutationFn: async (body) => {
      const { deviceId, action_type, payload, triggered_by } = body;
      const params = toCreateActionParams({
        actionType: action_type,
        action_type,
        payload,
        triggeredBy: triggered_by,
        triggered_by,
      });
      if (!params)
        throw new Error(i18n.t('common.paramsMapper.invalidIotAction'));
      const { urlPath, init } = stdbBffCommandPost('create_iot_action', {
        deviceId: deviceId,
        params: stdbParamsToJson(params as object),
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useAcknowledgeIotAction(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('acknowledge_iot_action', {
        actionId,
        resultPayload: null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useFailIotAction(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      actionId: ScalarId;
      reason?: string | null;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('fail_iot_action', {
        actionId: args.actionId,
        error: args.reason ?? null,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useRetryIotAction(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (actionId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('retry_iot_action', {
        actionId: actionId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useCreateIotAlert(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      deviceId: ScalarId;
      alert_type: string;
      severity: string;
      message: string;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('create_iot_alert', {
        deviceId: args.deviceId,
        alertType: args.alert_type,
        severity: args.severity,
        message: args.message,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useResolveIotAlert(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('resolve_iot_alert', {
        alertId: alertId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useSetIotThreshold(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      deviceId: ScalarId;
      sensor_type: string;
      min_value: number | null;
      max_value: number | null;
      severity: string;
    }) => {
      const { urlPath, init } = stdbBffCommandPost('set_iot_threshold', {
        deviceId: args.deviceId,
        sensorType: args.sensor_type,
        minValue: args.min_value,
        maxValue: args.max_value,
        severity: args.severity,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

export function useTestIotDevice(organizationId: bigint) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: ScalarId) => {
      const { urlPath, init } = stdbBffCommandPost('test_iot_device', {
        deviceId: deviceId,
      });
      const r = await apiFetch(urlPath, init);
      if (!r.ok) throw new Error(await parseCallError(r));
    },
    onSuccess: () => invalidateIotQueries(qc, organizationId),
  });
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  IoTAction,
  IoTAlert,
  IoTDevice,
  IoTHub,
  IoTPairingToken,
  IoTTelemetry,
  IoTThreshold,
} from '@lumiere/stdb/types';
