import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newIotHubForm = (t: TFunction): FormConfig => ({
  id: "new-iot-hub",
  title: t("iot.forms.newHub.title"),
  description: t("iot.forms.newHub.description"),
  sections: [
    {
      id: "hub",
      title: t("iot.forms.newHub.section"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("iot.table.name"),
          required: true,
          width: "full",
        },
        {
          id: "serial",
          name: "serial",
          type: "text",
          label: t("iot.table.serial"),
          required: true,
          width: "full",
        },
        {
          id: "ip_address",
          name: "ip_address",
          type: "text",
          label: t("iot.forms.newHub.ip"),
          width: "1/2",
        },
        {
          id: "firmware_version",
          name: "firmware_version",
          type: "text",
          label: t("iot.forms.newHub.firmware"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newIotDeviceForm = (t: TFunction): FormConfig => ({
  id: "new-iot-device",
  title: t("iot.forms.newDevice.title"),
  description: t("iot.forms.newDevice.description"),
  sections: [
    {
      id: "device",
      title: t("iot.forms.newDevice.section"),
      fields: [
        {
          id: "hub_id",
          name: "hub_id",
          type: "number",
          label: t("iot.forms.newDevice.hubId"),
          required: true,
          width: "full",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("iot.table.name"),
          required: true,
          width: "full",
        },
        {
          id: "device_type",
          name: "device_type",
          type: "text",
          label: t("iot.table.type"),
          required: true,
          defaultValue: "Sensor",
          width: "1/2",
        },
        {
          id: "identifier",
          name: "identifier",
          type: "text",
          label: t("iot.forms.newDevice.identifier"),
          required: true,
          width: "1/2",
        },
      ],
    },
  ],
})

/** Dev / gateway simulation — pairing claim. */
export const claimIotHubForm = (t: TFunction): FormConfig => ({
  id: "claim-iot-hub",
  title: t("iot.forms.claimHub.title"),
  description: t("iot.forms.claimHub.description"),
  sections: [
    {
      id: "claim",
      fields: [
        {
          id: "token",
          name: "token",
          type: "text",
          label: t("iot.table.token"),
          required: true,
          width: "full",
        },
        {
          id: "serial",
          name: "serial",
          type: "text",
          label: t("iot.table.serial"),
          required: true,
          width: "1/2",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("iot.table.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "ip_address",
          name: "ip_address",
          type: "text",
          label: t("iot.forms.newHub.ip"),
          width: "1/2",
        },
        {
          id: "firmware_version",
          name: "firmware_version",
          type: "text",
          label: t("iot.forms.newHub.firmware"),
          width: "1/2",
        },
      ],
    },
  ],
})

/** Dev — paste JSON array of DeviceSyncEntry. */
export const syncIotHubDevicesForm = (t: TFunction): FormConfig => ({
  id: "sync-iot-hub-devices",
  title: t("iot.forms.syncDevices.title"),
  description: t("iot.forms.syncDevices.description"),
  size: "lg",
  sections: [
    {
      id: "sync",
      fields: [
        {
          id: "hub_id",
          name: "hub_id",
          type: "number",
          label: t("iot.forms.syncDevices.hubId"),
          required: true,
          width: "full",
        },
        {
          id: "detected_json",
          name: "detected_json",
          type: "textarea",
          label: t("iot.forms.syncDevices.json"),
          description: t("iot.forms.syncDevices.jsonHint"),
          required: true,
          width: "full",
          rows: 8,
          defaultValue:
            '[{"identifier":"dev-1","name":"Dev device","device_type":"Sensor","capabilities":[]}]',
        },
      ],
    },
  ],
})

export function iotDeviceRowForm(t: TFunction, deviceId: string): FormConfig {
  return {
    id: "iot-device-row",
    title: t("iot.forms.deviceRow.title"),
    description: t("iot.forms.deviceRow.description", { id: deviceId }),
    sections: [
      {
        id: "op",
        title: t("iot.forms.deviceRow.section"),
        fields: [
          {
            id: "device_id",
            name: "device_id",
            type: "hidden",
            defaultValue: deviceId,
          },
          {
            id: "operation",
            name: "operation",
            type: "select",
            label: t("iot.forms.deviceRow.operation"),
            required: true,
            width: "full",
            options: [
              { value: "link_location", label: t("iot.forms.deviceRow.ops.linkLocation") },
              { value: "link_pos", label: t("iot.forms.deviceRow.ops.linkPos") },
              { value: "unlink", label: t("iot.forms.deviceRow.ops.unlink") },
              { value: "set_status", label: t("iot.forms.deviceRow.ops.setStatus") },
              { value: "record_telemetry", label: t("iot.forms.deviceRow.ops.telemetry") },
              { value: "test", label: t("iot.forms.deviceRow.ops.test") },
              { value: "delete", label: t("iot.forms.deviceRow.ops.delete") },
            ],
          },
          {
            id: "location_id",
            name: "location_id",
            type: "select",
            label: t("iot.devices.linkLocation"),
            width: "full",
            options: [],
          },
          {
            id: "pos_config_id",
            name: "pos_config_id",
            type: "number",
            label: t("iot.devices.posConfigId"),
            width: "full",
          },
          {
            id: "status",
            name: "status",
            type: "select",
            label: t("iot.table.status"),
            width: "full",
            options: [
              { value: "Online", label: "Online" },
              { value: "Offline", label: "Offline" },
              { value: "Error", label: "Error" },
              { value: "Pairing", label: "Pairing" },
              { value: "ConnectedNoServer", label: "ConnectedNoServer" },
            ],
          },
          {
            id: "sensor_type",
            name: "sensor_type",
            type: "text",
            label: t("iot.forms.deviceRow.sensorType"),
            defaultValue: "temperature",
            width: "1/2",
          },
          {
            id: "telemetry_value",
            name: "telemetry_value",
            type: "number",
            label: t("iot.forms.deviceRow.telemetryValue"),
            defaultValue: 0,
            width: "1/2",
          },
          {
            id: "unit",
            name: "unit",
            type: "text",
            label: t("iot.entities.telemetry.unit"),
            defaultValue: "°C",
            width: "full",
          },
        ],
      },
    ],
  }
}
