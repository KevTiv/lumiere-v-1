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
