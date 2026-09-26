import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

export const fleetVehiclesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "fleet-vehicles-table",
  title: t("fleet.subtitle"),
  description: t("fleet.forms.newVehicle.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: `${t("fleet.table.name")}, ${t("fleet.table.licensePlate")}…`,
    searchKeys: ["name", "license_plate", "vehicle_type", "driver_name", "status"],
    columns: [
      { key: "id", label: "ID", type: "number", align: "right", width: "min-w-16" },
      { key: "name", label: t("fleet.table.name"), width: "min-w-36" },
      { key: "vehicle_type", label: t("fleet.table.vehicleType"), width: "min-w-24" },
      { key: "license_plate", label: t("fleet.table.licensePlate"), width: "min-w-28" },
      { key: "driver_name", label: t("fleet.table.driverName"), width: "min-w-32" },
      { key: "status", label: t("fleet.table.status"), type: "badge" },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number", align: "right" },
      { key: "last_position_at", label: t("fleet.table.lastPosition"), type: "datetime" },
    ],
    emptyMessage: t("fleet.empty"),
  },
})

export const fleetServiceRecordsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "fleet-service-records-table",
  title: t("fleet.lifecycle.service.title"),
  description: t("fleet.lifecycle.service.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["vehicle_id", "provider", "notes"],
    columns: [
      { key: "vehicle_id", label: t("fleet.lifecycle.vehicle"), type: "number" },
      { key: "service_type_id", label: t("fleet.lifecycle.serviceType"), type: "number" },
      { key: "serviced_at", label: t("fleet.lifecycle.servicedAt"), type: "datetime" },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number" },
      { key: "provider", label: t("fleet.lifecycle.provider") },
      { key: "notes", label: t("fleet.lifecycle.notes") },
    ],
    emptyMessage: t("fleet.lifecycle.service.empty"),
  },
})

export const fleetInspectionsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "fleet-inspections-table",
  title: t("fleet.lifecycle.inspections.title"),
  description: t("fleet.lifecycle.inspections.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["vehicle_id", "outcome", "notes"],
    columns: [
      { key: "vehicle_id", label: t("fleet.lifecycle.vehicle"), type: "number" },
      { key: "inspector_id", label: t("fleet.lifecycle.inspector"), type: "number" },
      { key: "inspected_at", label: t("fleet.lifecycle.inspectedAt"), type: "datetime" },
      { key: "outcome", label: t("fleet.lifecycle.outcome"), type: "badge" },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number" },
      { key: "notes", label: t("fleet.lifecycle.notes") },
    ],
    emptyMessage: t("fleet.lifecycle.inspections.empty"),
  },
})
