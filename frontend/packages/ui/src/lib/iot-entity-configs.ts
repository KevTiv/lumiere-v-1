import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

export const iotPairingTokensTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "iot-pairing-tokens-table",
  title: t("iot.entities.pairingTokens.title"),
  description: t("iot.entities.pairingTokens.description"),
  view: {
    mode: "table",
    rowKey: "token",
    searchable: true,
    searchPlaceholder: t("iot.entities.pairingTokens.searchPlaceholder"),
    searchKeys: ["token"],
    columns: [
      { key: "token", label: t("iot.table.token"), width: "min-w-48" },
      { key: "used", label: t("iot.table.used"), type: "boolean" },
      { key: "expires_at", label: t("iot.table.expires"), type: "datetime" },
      { key: "company_id", label: t("iot.entities.pairingTokens.company"), type: "number", align: "right" },
    ],
    emptyMessage: t("iot.hubs.noTokens"),
  },
})

export const iotHubsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "iot-hubs-table",
  title: t("iot.entities.hubs.title"),
  description: t("iot.entities.hubs.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("iot.entities.hubs.searchPlaceholder"),
    searchKeys: ["name", "serial", "status"],
    columns: [
      { key: "id", label: "ID", type: "number", align: "right", width: "min-w-16" },
      { key: "name", label: t("iot.table.name"), width: "min-w-36" },
      { key: "serial", label: t("iot.table.serial"), width: "min-w-28" },
      { key: "status", label: t("iot.table.status"), type: "badge" },
      { key: "ip_address", label: t("iot.entities.hubs.ip"), width: "min-w-28" },
      { key: "last_heartbeat", label: t("iot.entities.hubs.lastHeartbeat"), type: "datetime" },
    ],
    emptyMessage: t("iot.entities.hubs.empty"),
  },
})

export const iotDevicesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "iot-devices-table",
  title: t("iot.entities.devices.title"),
  description: t("iot.entities.devices.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("iot.entities.devices.searchPlaceholder"),
    searchKeys: ["name", "identifier", "device_type", "status"],
    columns: [
      { key: "id", label: "ID", type: "number", align: "right", width: "min-w-16" },
      { key: "name", label: t("iot.table.name"), width: "min-w-32" },
      { key: "device_type", label: t("iot.table.type"), width: "min-w-24" },
      { key: "identifier", label: t("iot.entities.devices.identifier"), width: "min-w-28" },
      { key: "status", label: t("iot.table.status"), type: "badge" },
      { key: "hub_id", label: t("iot.entities.devices.hub"), type: "number", align: "right" },
      { key: "stock_location_id", label: t("iot.entities.devices.stockLocation"), type: "number", align: "right" },
      { key: "pos_config_id", label: t("iot.entities.devices.posConfig"), type: "number", align: "right" },
    ],
    emptyMessage: t("iot.entities.devices.empty"),
  },
})

export const iotActionsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "iot-actions-table",
  title: t("iot.entities.actions.title"),
  description: t("iot.entities.actions.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("iot.entities.actions.searchPlaceholder"),
    searchKeys: ["action_type", "status", "payload"],
    columns: [
      { key: "id", label: "ID", type: "number", align: "right", width: "min-w-16" },
      { key: "device_id", label: t("iot.entities.actions.device"), type: "number", align: "right" },
      { key: "action_type", label: t("iot.table.type"), width: "min-w-28" },
      { key: "status", label: t("iot.table.status"), type: "badge" },
      { key: "created_at", label: t("iot.entities.actions.created"), type: "datetime" },
      { key: "sent_at", label: t("iot.entities.actions.sent"), type: "datetime" },
    ],
    emptyMessage: t("iot.entities.actions.empty"),
  },
})

export const iotTelemetryTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "iot-telemetry-table",
  title: t("iot.entities.telemetry.title"),
  description: t("iot.entities.telemetry.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("iot.entities.telemetry.searchPlaceholder"),
    searchKeys: ["sensor_type", "unit", "quality"],
    columns: [
      { key: "id", label: "ID", type: "number", align: "right", width: "min-w-16" },
      { key: "device_id", label: t("iot.entities.telemetry.device"), type: "number", align: "right" },
      { key: "sensor_type", label: t("iot.entities.telemetry.sensor"), width: "min-w-24" },
      { key: "value", label: t("iot.entities.telemetry.value"), type: "number", align: "right" },
      { key: "unit", label: t("iot.entities.telemetry.unit"), width: "min-w-16" },
      { key: "quality", label: t("iot.entities.telemetry.quality"), type: "badge" },
      { key: "recorded_at", label: t("iot.entities.telemetry.recorded"), type: "datetime" },
    ],
    emptyMessage: t("iot.entities.telemetry.empty"),
  },
})
