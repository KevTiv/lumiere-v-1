"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  MissingOrganization,
  mergeSelectOptionsForFields,
  claimIotHubForm,
  syncIotHubDevicesForm,
  iotDeviceRowForm,
  newIotHubForm,
  newIotDeviceForm,
} from "@lumiere/ui"
import type { EntityViewConfig, EntityAction, FormConfig } from "@lumiere/ui"
import { iotModuleConfig } from "@/lib/module-dashboard-configs"
import { useIotModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import type { QueryRows } from "@/lib/query-fetch"
import { useStockLocations } from "@lumiere/query-hooks/hooks/inventory"
import {
  useIotActions,
  useIotDevices,
  useIotHubs,
  useIotPairingTokens,
  useIotAlerts,
  useIotTelemetry,
  useIotThresholds,
  useGenerateHubPairingToken,
  useRegisterIotHub,
  useRegisterIotDevice,
  useDeleteIotHub,
  useDeleteIotDevice,
  useLinkDeviceToLocation,
  useLinkDeviceToPos,
  useUnlinkDevice,
  useUpdateHubHeartbeat,
  useSyncHubDevices,
  useUpdateDeviceStatus,
  useRecordTelemetry,
  useRecordTelemetryBatch,
  useMarkActionSent,
  useCreateIotAction,
  useAcknowledgeIotAction,
  useFailIotAction,
  useRetryIotAction,
  useCreateIotAlert,
  useResolveIotAlert,
  useSetIotThreshold,
  useClaimHubWithToken,
  useTestIotDevice,
} from "@lumiere/query-hooks/hooks/iot"

interface IotClientProps {
  initialDevices?: QueryRows
  initialHubs?: QueryRows
  initialPairingTokens?: QueryRows
  initialActions?: QueryRows
  initialTelemetry?: QueryRows
  initialAlerts?: QueryRows
  initialThresholds?: QueryRows
  organizationId?: number
}

type Loaded = Omit<IotClientProps, "organizationId"> & { organizationId: number }

function str(v: unknown): string {
  return v == null ? "" : String(v)
}

function numField(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k]
    if (v != null && v !== "") {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

function withTableToolbar(ec: EntityViewConfig, actions: EntityAction[]): EntityViewConfig {
  if (ec.view.mode !== "table") return ec
  return {
    ...ec,
    view: {
      ...ec.view,
      rowSelectionToggleOnClick: true,
      actions,
    },
  }
}

type IotModalState =
  | { type: null }
  | { type: "createAction"; form: FormConfig; rows: Record<string, unknown>[] }
  | { type: "failAction"; form: FormConfig; rows: Record<string, unknown>[] }
  | { type: "createAlert"; form: FormConfig; rows: Record<string, unknown>[] }
  | { type: "setThreshold"; form: FormConfig; rows: Record<string, unknown>[] }
  | { type: "telemetryBatch"; form: FormConfig; rows: Record<string, unknown>[] }

const createActionForm: FormConfig = {
  id: "iot-create-action",
  title: "Create IoT Action",
  submitLabel: "Create action",
  sections: [
    {
      id: "action",
      fields: [
        { id: "action-type", type: "text", name: "action_type", label: "Action type", required: true, width: "1/2" },
        { id: "triggered-by", type: "text", name: "triggered_by", label: "Triggered by", defaultValue: "web", width: "1/2" },
        { id: "payload", type: "textarea", name: "payload", label: "Payload JSON/string", required: true, rows: 4, width: "full" },
      ],
    },
  ],
}

const failActionForm: FormConfig = {
  id: "iot-fail-action",
  title: "Fail IoT Action",
  submitLabel: "Mark failed",
  sections: [
    {
      id: "failure",
      fields: [
        { id: "reason", type: "textarea", name: "reason", label: "Reason", rows: 3, width: "full" },
      ],
    },
  ],
}

const createAlertForm: FormConfig = {
  id: "iot-create-alert",
  title: "Create IoT Alert",
  submitLabel: "Create alert",
  sections: [
    {
      id: "alert",
      fields: [
        { id: "type", type: "text", name: "alert_type", label: "Alert type", required: true, width: "1/2" },
        { id: "severity", type: "text", name: "severity", label: "Severity", defaultValue: "warning", width: "1/2" },
        { id: "message", type: "textarea", name: "message", label: "Message", required: true, rows: 3, width: "full" },
      ],
    },
  ],
}

const setThresholdForm: FormConfig = {
  id: "iot-set-threshold",
  title: "Set IoT Threshold",
  submitLabel: "Save threshold",
  sections: [
    {
      id: "threshold",
      fields: [
        { id: "sensor", type: "text", name: "sensor_type", label: "Sensor type", required: true, width: "1/2" },
        { id: "severity", type: "text", name: "severity", label: "Severity", defaultValue: "warning", width: "1/2" },
        { id: "min", type: "number", name: "min_value", label: "Min value", width: "1/2" },
        { id: "max", type: "number", name: "max_value", label: "Max value", width: "1/2" },
      ],
    },
  ],
}

const telemetryBatchForm: FormConfig = {
  id: "iot-record-telemetry-batch",
  title: "Record Telemetry Batch",
  description: "Provide an array of telemetry readings with sensor_type, value, unit, and quality.",
  submitLabel: "Record batch",
  sections: [
    {
      id: "readings",
      fields: [
        { id: "readings-json", type: "textarea", name: "readingsJson", label: "Readings JSON", required: true, rows: 8, width: "full" },
      ],
    },
  ],
}

function selectedIds(rows: Record<string, unknown>[]): Array<string | number | bigint> {
  return rows
    .map((row) => row.id as string | number | bigint | undefined)
    .filter((id): id is string | number | bigint => id != null && String(id).trim() !== "")
}

function parseTelemetryReadings(value: unknown) {
  const parsed = JSON.parse(String(value ?? "")) as unknown
  if (!Array.isArray(parsed)) throw new Error("Readings JSON must be an array")
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Each reading must be an object")
    const row = entry as Record<string, unknown>
    const value = Number(row.value)
    if (!Number.isFinite(value)) throw new Error("Each reading needs a numeric value")
    return {
      sensor_type: String(row.sensor_type ?? row.sensorType ?? ""),
      value,
      raw_value: row.raw_value != null ? String(row.raw_value) : row.rawValue != null ? String(row.rawValue) : null,
      unit: String(row.unit ?? ""),
      quality: String(row.quality ?? "good"),
    }
  })
}

export function IotClient(props: IotClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <IotClientLoaded {...props} organizationId={props.organizationId} />
}

function IotClientLoaded({
  initialDevices,
  initialHubs,
  initialPairingTokens,
  initialActions,
  initialTelemetry,
  initialAlerts,
  initialThresholds,
  organizationId,
}: Loaded) {
  useIotModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const moduleConfigBase = useMemo(() => iotModuleConfig(t), [t])

  const { data: devices = [] } = useIotDevices(orgId, initialDevices)
  const { data: hubs = [] } = useIotHubs(orgId, initialHubs)
  const { data: pairingTokens = [] } = useIotPairingTokens(orgId, initialPairingTokens)
  const { data: actions = [] } = useIotActions(orgId, initialActions)
  const { data: telemetry = [] } = useIotTelemetry(orgId, initialTelemetry)
  const { data: alerts = [] } = useIotAlerts(orgId, initialAlerts)
  const { data: thresholds = [] } = useIotThresholds(orgId, initialThresholds)
  const { data: locations = [] } = useStockLocations(orgId)

  const genPairing = useGenerateHubPairingToken(orgId)
  const registerHub = useRegisterIotHub(orgId)
  const registerDevice = useRegisterIotDevice(orgId)
  const deleteHub = useDeleteIotHub(orgId)
  const deleteDevice = useDeleteIotDevice(orgId)
  const linkLoc = useLinkDeviceToLocation(orgId)
  const linkPos = useLinkDeviceToPos(orgId)
  const unlink = useUnlinkDevice(orgId)
  const hubHeartbeat = useUpdateHubHeartbeat(orgId)
  const syncDevices = useSyncHubDevices(orgId)
  const setDeviceStatus = useUpdateDeviceStatus(orgId)
  const recordTelemetry = useRecordTelemetry(orgId)
  const recordTelemetryBatch = useRecordTelemetryBatch(orgId)
  const markSent = useMarkActionSent(orgId)
  const createAction = useCreateIotAction(orgId)
  const acknowledgeAction = useAcknowledgeIotAction(orgId)
  const failAction = useFailIotAction(orgId)
  const retryAction = useRetryIotAction(orgId)
  const createAlert = useCreateIotAlert(orgId)
  const resolveAlert = useResolveIotAlert(orgId)
  const setThreshold = useSetIotThreshold(orgId)
  const claimHub = useClaimHubWithToken(orgId)
  const testDevice = useTestIotDevice(orgId)

  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [toolbarError, setToolbarError] = useState<string | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [dashForm, setDashForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [dashFormError, setDashFormError] = useState<string | null>(null)
  const [deviceRow, setDeviceRow] = useState<Record<string, unknown> | null>(null)
  const [rowSubmitError, setRowSubmitError] = useState<string | null>(null)
  const [iotModal, setIotModal] = useState<IotModalState>({ type: null })
  const [iotModalError, setIotModalError] = useState<string | null>(null)

  const locationOptions = useMemo(() => {
    return [...locations]
      .map((r) => ({
        value: String(numField(r as Record<string, unknown>, "id", "Id")),
        label:
          str((r as Record<string, unknown>).complete_name) ||
          str((r as Record<string, unknown>).name) ||
          String(numField(r as Record<string, unknown>, "id", "Id")),
      }))
      .filter((o) => o.value !== "0")
  }, [locations])

  const deviceIdStr = deviceRow
    ? String(numField(deviceRow, "id", "Id") || "")
    : ""

  const deviceRowFormConfig = useMemo((): FormConfig | null => {
    if (!deviceIdStr) return null
    const base = iotDeviceRowForm(t, deviceIdStr)
    return mergeSelectOptionsForFields(base, { location_id: locationOptions })
  }, [t, deviceIdStr, locationOptions])

  const pendingActions = useMemo(
    () => actions.filter((r) => str((r as Record<string, unknown>).status) === "Pending").length,
    [actions],
  )

  const unusedTokens = useMemo(
    () =>
      pairingTokens.filter((r) => {
        const row = r as Record<string, unknown>
        return row.used !== true && row.used !== 1 && str(row.used) !== "true"
      }).length,
    [pairingTokens],
  )

  const liveSections = useMemo(() => {
    return mapDashboardWidgets(moduleConfigBase, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                {
                  label: t("iot.dashboard.stats.devices"),
                  value: String(devices.length),
                  icon: "package",
                },
                {
                  label: t("iot.dashboard.stats.hubs"),
                  value: String(hubs.length),
                  icon: "Activity",
                },
                {
                  label: t("iot.dashboard.stats.pendingActions"),
                  value: String(pendingActions),
                  icon: "BarChart2",
                },
                {
                  label: t("iot.dashboard.stats.unusedTokens"),
                  value: String(unusedTokens),
                  icon: "template",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            generate_pairing_token: () => {
              setBanner(null)
              genPairing.mutate(undefined, {
                onSuccess: () =>
                  setBanner({ kind: "ok", text: t("iot.hubs.pairingGenerated") }),
                onError: (e) =>
                  setBanner({ kind: "err", text: e instanceof Error ? e.message : String(e) }),
              })
            },
            register_hub: () => {
              setDashFormError(null)
              setDashForm({ form: newIotHubForm(t), action: "registerIotHub" })
            },
            register_device: () => {
              setDashFormError(null)
              setDashForm({ form: newIotDeviceForm(t), action: "registerIotDevice" })
            },
            claim_hub_dev: () => {
              setToolbarError(null)
              setClaimOpen(true)
            },
            sync_devices_dev: () => {
              setToolbarError(null)
              setSyncOpen(true)
            },
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
          })
  }, [
    moduleConfigBase,
    devices.length,
    hubs.length,
    pendingActions,
    unusedTokens,
    t,
    genPairing,
  ])

  const config = useMemo(
    () => ({
      ...moduleConfigBase,
      tabs: withDashboardSections(moduleConfigBase, liveSections).tabs.map((tab) => {
        if (tab.id === "iot-hubs" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableToolbar(tab.entityConfig, [
              {
                id: "hub-heartbeat",
                label: t("iot.hubs.pingHeartbeat"),
                requiresSelection: true,
                onClick: (rows) => {
                  setToolbarError(null)
                  if (rows.length !== 1) {
                    setToolbarError(t("iot.toolbar.selectOneHub"))
                    return
                  }
                  const id = numField(rows[0]!, "id", "Id")
                  hubHeartbeat.mutate(
                    { hubId: id, connectivityQuality: "good" },
                    {
                      onSuccess: () =>
                        setBanner({ kind: "ok", text: t("iot.hubs.heartbeatOk") }),
                      onError: (e) =>
                        setToolbarError(e instanceof Error ? e.message : String(e)),
                    },
                  )
                },
              },
              {
                id: "hub-delete",
                label: t("common.delete"),
                variant: "destructive",
                requiresSelection: true,
                onClick: (rows) => {
                  setToolbarError(null)
                  if (rows.length !== 1) {
                    setToolbarError(t("iot.toolbar.selectOneHub"))
                    return
                  }
                  if (!confirm(t("iot.hubs.confirmDeleteHub"))) return
                  const id = numField(rows[0]!, "id", "Id")
                  deleteHub.mutate(id, {
                    onSuccess: () =>
                      setBanner({ kind: "ok", text: t("iot.hubs.hubDeleted") }),
                    onError: (e) =>
                      setToolbarError(e instanceof Error ? e.message : String(e)),
                  })
                },
              },
            ]),
          }
        }
        if (tab.id === "iot-actions" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableToolbar(tab.entityConfig, [
              {
                id: "mark-sent",
                label: t("iot.actions.markSent"),
                requiresSelection: true,
                onClick: (rows) => {
                  setToolbarError(null)
                  if (rows.length !== 1) {
                    setToolbarError(t("iot.toolbar.selectOneAction"))
                    return
                  }
                  const row = rows[0]!
                  if (str(row.status) !== "Pending") {
                    setToolbarError(t("iot.toolbar.actionNotPending"))
                    return
                  }
                  const id = numField(row, "id", "Id")
                  markSent.mutate(id, {
                    onSuccess: () =>
                      setBanner({ kind: "ok", text: t("iot.actions.markedSent") }),
                    onError: (e) =>
                      setToolbarError(e instanceof Error ? e.message : String(e)),
                  })
                },
              },
              {
                id: "ack-action",
                label: "Acknowledge",
                requiresSelection: true,
                onClick: (rows) => {
                  setToolbarError(null)
                  void Promise.all(
                    selectedIds(rows).map((actionId) => acknowledgeAction.mutateAsync(actionId)),
                  ).then(
                    () => setBanner({ kind: "ok", text: "IoT action acknowledged" }),
                    (e) => setToolbarError(e instanceof Error ? e.message : String(e)),
                  )
                },
              },
              {
                id: "retry-action",
                label: "Retry",
                requiresSelection: true,
                onClick: (rows) => {
                  setToolbarError(null)
                  void Promise.all(
                    selectedIds(rows).map((actionId) => retryAction.mutateAsync(actionId)),
                  ).then(
                    () => setBanner({ kind: "ok", text: "IoT action retry queued" }),
                    (e) => setToolbarError(e instanceof Error ? e.message : String(e)),
                  )
                },
              },
              {
                id: "fail-action",
                label: "Fail",
                requiresSelection: true,
                variant: "destructive",
                onClick: (rows) => {
                  setIotModalError(null)
                  setIotModal({ type: "failAction", form: failActionForm, rows })
                },
              },
            ]),
          }
        }
        if (tab.id === "iot-alerts" && tab.entityConfig) {
          return {
            ...tab,
            entityConfig: withTableToolbar(tab.entityConfig, [
              {
                id: "resolve-alert",
                label: "Resolve",
                requiresSelection: true,
                onClick: (rows) => {
                  setToolbarError(null)
                  void Promise.all(
                    selectedIds(rows).map((alertId) => resolveAlert.mutateAsync(alertId)),
                  ).then(
                    () => setBanner({ kind: "ok", text: "IoT alert resolved" }),
                    (e) => setToolbarError(e instanceof Error ? e.message : String(e)),
                  )
                },
              },
            ]),
          }
        }
        return tab
      }),
    }),
    [
      moduleConfigBase,
      liveSections,
      t,
      hubHeartbeat,
      deleteHub,
      markSent,
      acknowledgeAction,
      retryAction,
      resolveAlert,
    ],
  )

  const data = useMemo(
    () => ({
      "iot-pairing-tokens": pairingTokens as Record<string, unknown>[],
      "iot-hubs": hubs as Record<string, unknown>[],
      "iot-devices": devices as Record<string, unknown>[],
      "iot-actions": actions as Record<string, unknown>[],
      "iot-telemetry": telemetry as Record<string, unknown>[],
      "iot-alerts": alerts as Record<string, unknown>[],
      "iot-thresholds": thresholds as Record<string, unknown>[],
    }),
    [pairingTokens, hubs, devices, actions, telemetry, alerts, thresholds],
  )

  const handleFormSubmit = async (_tabId: string, action: string, formData: Record<string, unknown>) => {
    if (action === "registerIotHub") {
      await registerHub.mutateAsync({
        name: String(formData.name ?? ""),
        serial: String(formData.serial ?? ""),
        ip_address: formData.ip_address ? String(formData.ip_address) : null,
        firmware_version: formData.firmware_version ? String(formData.firmware_version) : null,
        metadata: null,
      })
      setBanner({ kind: "ok", text: t("iot.hubs.hubRegistered") })
    } else if (action === "registerIotDevice") {
      const hubId = Number(formData.hub_id)
      if (!Number.isFinite(hubId) || hubId <= 0) throw new Error(t("iot.forms.errors.invalidHubId"))
      await registerDevice.mutateAsync({
        hubId,
        params: {
          name: String(formData.name ?? ""),
          device_type: String(formData.device_type ?? ""),
          identifier: String(formData.identifier ?? ""),
          capabilities: [],
          metadata: null,
        },
      })
      setBanner({ kind: "ok", text: t("iot.devices.registered") })
    }
  }

  const handleDeviceRowSubmit = async (formData: Record<string, unknown>) => {
    setRowSubmitError(null)
    const deviceId = Number(formData.device_id)
    const op = String(formData.operation ?? "")
    if (op === "link_location") {
      const lid = String(formData.location_id ?? "").trim()
      if (!lid) throw new Error(t("iot.forms.errors.pickLocation"))
      await linkLoc.mutateAsync({ deviceId, locationId: lid })
    } else if (op === "link_pos") {
      const pid = Number(formData.pos_config_id)
      if (!Number.isFinite(pid) || pid <= 0) throw new Error(t("iot.forms.errors.invalidPosId"))
      await linkPos.mutateAsync({ deviceId, posConfigId: pid })
    } else if (op === "unlink") {
      await unlink.mutateAsync(deviceId)
    } else if (op === "set_status") {
      await setDeviceStatus.mutateAsync({
        deviceId,
        status: String(formData.status ?? "Online"),
      })
    } else if (op === "record_telemetry") {
      const v = Number(formData.telemetry_value)
      if (!Number.isFinite(v)) throw new Error(t("iot.forms.errors.invalidTelemetryValue"))
      await recordTelemetry.mutateAsync({
        deviceId,
        params: {
          sensor_type: String(formData.sensor_type ?? "temperature"),
          value: v,
          raw_value: null,
          unit: String(formData.unit ?? ""),
          quality: "good",
        },
      })
    } else if (op === "test") {
      await testDevice.mutateAsync(deviceId)
    } else if (op === "delete") {
      if (!confirm(t("iot.devices.confirmDelete"))) return
      await deleteDevice.mutateAsync(deviceId)
      setDeviceRow(null)
    } else {
      throw new Error(t("iot.forms.errors.unknownOperation"))
    }
    setBanner({ kind: "ok", text: t("iot.forms.deviceRow.done") })
    setDeviceRow(null)
  }

  const handleIotModalSubmit = async (formData: Record<string, unknown>) => {
    if (iotModal.type === null) return
    setIotModalError(null)
    try {
      const ids = selectedIds(iotModal.rows)
      if (ids.length === 0) throw new Error("Select at least one row")
      if (iotModal.type === "createAction") {
        await Promise.all(
          ids.map((deviceId) =>
            createAction.mutateAsync({
              deviceId,
              action_type: String(formData.action_type ?? ""),
              payload: String(formData.payload ?? ""),
              triggered_by: String(formData.triggered_by ?? "web"),
            }),
          ),
        )
        setBanner({ kind: "ok", text: "IoT action created" })
      } else if (iotModal.type === "failAction") {
        await Promise.all(
          ids.map((actionId) =>
            failAction.mutateAsync({
              actionId,
              reason: formData.reason ? String(formData.reason) : null,
            }),
          ),
        )
        setBanner({ kind: "ok", text: "IoT action failed" })
      } else if (iotModal.type === "createAlert") {
        await Promise.all(
          ids.map((deviceId) =>
            createAlert.mutateAsync({
              deviceId,
              alert_type: String(formData.alert_type ?? ""),
              severity: String(formData.severity ?? "warning"),
              message: String(formData.message ?? ""),
            }),
          ),
        )
        setBanner({ kind: "ok", text: "IoT alert created" })
      } else if (iotModal.type === "setThreshold") {
        const minRaw = formData.min_value
        const maxRaw = formData.max_value
        await Promise.all(
          ids.map((deviceId) =>
            setThreshold.mutateAsync({
              deviceId,
              sensor_type: String(formData.sensor_type ?? ""),
              min_value:
                minRaw != null && String(minRaw).trim() !== "" ? Number(minRaw) : null,
              max_value:
                maxRaw != null && String(maxRaw).trim() !== "" ? Number(maxRaw) : null,
              severity: String(formData.severity ?? "warning"),
            }),
          ),
        )
        setBanner({ kind: "ok", text: "IoT threshold saved" })
      } else if (iotModal.type === "telemetryBatch") {
        const readings = parseTelemetryReadings(formData.readingsJson)
        await Promise.all(
          ids.map((deviceId) => recordTelemetryBatch.mutateAsync({ deviceId, readings })),
        )
        setBanner({ kind: "ok", text: "IoT telemetry batch recorded" })
      }
      setIotModal({ type: null })
    } catch (e) {
      setIotModalError(e instanceof Error ? e.message : String(e))
    }
  }

  const isIotMutationPending =
    genPairing.isPending ||
    registerHub.isPending ||
    registerDevice.isPending ||
    deleteHub.isPending ||
    deleteDevice.isPending ||
    linkLoc.isPending ||
    linkPos.isPending ||
    unlink.isPending ||
    hubHeartbeat.isPending ||
    syncDevices.isPending ||
    setDeviceStatus.isPending ||
    recordTelemetry.isPending ||
    recordTelemetryBatch.isPending ||
    markSent.isPending ||
    createAction.isPending ||
    acknowledgeAction.isPending ||
    failAction.isPending ||
    retryAction.isPending ||
    createAlert.isPending ||
    resolveAlert.isPending ||
    setThreshold.isPending ||
    claimHub.isPending ||
    testDevice.isPending

  return (
    <>
      {banner && (
        <div
          className={
            banner.kind === "err"
              ? "mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              : "mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          }
        >
          {banner.text}
        </div>
      )}
      {toolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {toolbarError}
        </p>
      ) : null}
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={(tabId, row) => {
          if (tabId === "iot-devices") setDeviceRow(row)
        }}
        isPending={isIotMutationPending}
      />
      <FormModal
        open={dashForm !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDashForm(null)
            setDashFormError(null)
          }
        }}
        config={dashForm?.form ?? newIotHubForm(t)}
        isPending={isIotMutationPending}
        submitError={dashFormError}
        onSubmit={async (formData) => {
          setDashFormError(null)
          if (!dashForm) return
          try {
            await handleFormSubmit("dashboard", dashForm.action, formData)
            setDashForm(null)
          } catch (e) {
            setDashFormError(e instanceof Error ? e.message : String(e))
            throw e
          }
        }}
      />
      <FormModal
        open={claimOpen}
        onOpenChange={setClaimOpen}
        config={claimIotHubForm(t)}
        isPending={isIotMutationPending}
        onSubmit={async (fd) => {
          await claimHub.mutateAsync({
            token: String(fd.token ?? "").trim(),
            serial: String(fd.serial ?? "").trim(),
            name: String(fd.name ?? "").trim(),
            ipAddress: fd.ip_address ? String(fd.ip_address) : null,
            firmwareVersion: fd.firmware_version ? String(fd.firmware_version) : null,
          })
          setBanner({ kind: "ok", text: t("iot.developer.claimOk") })
        }}
      />
      <FormModal
        open={syncOpen}
        onOpenChange={setSyncOpen}
        config={syncIotHubDevicesForm(t)}
        isPending={isIotMutationPending}
        closeOnSubmit={false}
        onSubmit={async (fd) => {
          const hid = Number(fd.hub_id)
          if (!Number.isFinite(hid) || hid <= 0) throw new Error(t("iot.forms.errors.invalidHubId"))
          let parsed: unknown
          try {
            parsed = JSON.parse(String(fd.detected_json ?? "")) as unknown
          } catch {
            throw new Error(t("iot.forms.errors.invalidJson"))
          }
          if (!Array.isArray(parsed)) throw new Error(t("iot.forms.errors.jsonNotArray"))
          const detected = parsed.map((item) => {
            if (!item || typeof item !== "object") throw new Error(t("iot.forms.errors.badSyncEntry"))
            const o = item as Record<string, unknown>
            return {
              identifier: String(o.identifier ?? ""),
              name: String(o.name ?? ""),
              device_type: String(o.device_type ?? o.deviceType ?? ""),
              capabilities: Array.isArray(o.capabilities) ? o.capabilities.map(String) : [],
            }
          })
          await syncDevices.mutateAsync({ hubId: hid, detected })
          setBanner({ kind: "ok", text: t("iot.developer.syncOk") })
          setSyncOpen(false)
        }}
      />
      {deviceRowFormConfig ? (
        <FormModal
          key={deviceIdStr}
          open={deviceRow !== null}
          onOpenChange={(o) => {
            if (!o) {
              setDeviceRow(null)
              setRowSubmitError(null)
            }
          }}
          config={deviceRowFormConfig}
          closeOnSubmit={false}
          submitError={rowSubmitError}
          isPending={isIotMutationPending}
          onSubmit={handleDeviceRowSubmit}
        />
      ) : null}
      {iotModal.type !== null ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setIotModal({ type: null })
              setIotModalError(null)
            }
          }}
          config={iotModal.form}
          isPending={isIotMutationPending}
          closeOnSubmit={false}
          submitError={iotModalError}
          onSubmit={handleIotModalSubmit}
        />
      ) : null}
    </>
  )
}
