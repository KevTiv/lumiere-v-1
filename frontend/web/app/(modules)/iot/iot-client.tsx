"use client"

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
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import type { QueryRows } from "@/lib/query-fetch"
import { useStockLocations } from "@/hooks/inventory"
import {
  useIotActions,
  useIotDevices,
  useIotHubs,
  useIotPairingTokens,
  useIotTelemetry,
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
  useMarkActionSent,
  useClaimHubWithToken,
  useTestIotDevice,
} from "@/hooks/iot"

interface IotClientProps {
  initialDevices?: QueryRows
  initialHubs?: QueryRows
  initialPairingTokens?: QueryRows
  initialActions?: QueryRows
  initialTelemetry?: QueryRows
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
  organizationId,
}: Loaded) {
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const moduleConfigBase = useMemo(() => iotModuleConfig(t), [t])

  const { data: devices = [] } = useIotDevices(orgId, initialDevices)
  const { data: hubs = [] } = useIotHubs(orgId, initialHubs)
  const { data: pairingTokens = [] } = useIotPairingTokens(orgId, initialPairingTokens)
  const { data: actions = [] } = useIotActions(orgId, initialActions)
  const { data: telemetry = [] } = useIotTelemetry(orgId, initialTelemetry)
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
  const markSent = useMarkActionSent(orgId)
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
    const dashboardTab = moduleConfigBase.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
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
      }),
    }))
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
      tabs: moduleConfigBase.tabs.map((tab) => {
        if (tab.id === "dashboard") return { ...tab, sections: liveSections }
        if (tab.id === "iot-devices" && tab.entityConfig && tab.entityConfig.view.mode === "table") {
          return {
            ...tab,
            entityConfig: {
              ...tab.entityConfig,
              view: { ...tab.entityConfig.view, rowSelectionToggleOnClick: false },
            },
          }
        }
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
            ]),
          }
        }
        return tab
      }),
    }),
    [moduleConfigBase, liveSections, t, hubHeartbeat, deleteHub, markSent],
  )

  const data = useMemo(
    () => ({
      "iot-pairing-tokens": pairingTokens as Record<string, unknown>[],
      "iot-hubs": hubs as Record<string, unknown>[],
      "iot-devices": devices as Record<string, unknown>[],
      "iot-actions": actions as Record<string, unknown>[],
      "iot-telemetry": telemetry as Record<string, unknown>[],
    }),
    [pairingTokens, hubs, devices, actions, telemetry],
  )

  const runRegisterIotHub = async (formData: Record<string, unknown>) => {
    await registerHub.mutateAsync({
      name: String(formData.name ?? ""),
      serial: String(formData.serial ?? ""),
      ip_address: formData.ip_address ? String(formData.ip_address) : null,
      firmware_version: formData.firmware_version ? String(formData.firmware_version) : null,
      metadata: null,
    })
    setBanner({ kind: "ok", text: t("iot.hubs.hubRegistered") })
  }

  const runRegisterIotDevice = async (formData: Record<string, unknown>) => {
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

  const handleFormSubmit = async (_tabId: string, action: string, formData: Record<string, unknown>) => {
    if (action === "registerIotHub") await runRegisterIotHub(formData)
    else if (action === "registerIotDevice") await runRegisterIotDevice(formData)
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
        submitError={dashFormError}
        onSubmit={async (fd) => {
          setDashFormError(null)
          if (!dashForm) return
          try {
            await handleFormSubmit("dashboard", dashForm.action, fd)
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
          onSubmit={handleDeviceRowSubmit}
        />
      ) : null}
    </>
  )
}
