import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newFleetVehicleForm = (t: TFunction): FormConfig => ({
  id: "new-fleet-vehicle",
  title: t("fleet.forms.newVehicle.title"),
  description: t("fleet.forms.newVehicle.description"),
  sections: [
    {
      id: "vehicle",
      title: t("fleet.forms.newVehicle.section"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("fleet.table.name"),
          required: true,
          width: "full",
        },
        {
          id: "vehicle_type",
          name: "vehicle_type",
          type: "text",
          label: t("fleet.table.vehicleType"),
          required: true,
          defaultValue: "truck",
          width: "1/2",
        },
        {
          id: "license_plate",
          name: "license_plate",
          type: "text",
          label: t("fleet.table.licensePlate"),
          width: "1/2",
        },
        {
          id: "driver_name",
          name: "driver_name",
          type: "text",
          label: t("fleet.table.driverName"),
          width: "full",
        },
      ],
    },
  ],
})
