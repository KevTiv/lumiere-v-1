import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export interface FleetFormOption {
  value: string
  label: string
}

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

const optionalDate = (id: string, label: string) => ({
  id,
  name: id,
  type: "datetime" as const,
  label,
  width: "1/2" as const,
})

const notesField = (t: TFunction) => ({
  id: "notes",
  name: "notes",
  type: "textarea" as const,
  label: t("fleet.lifecycle.notes"),
  width: "full" as const,
})

export const assignFleetDriverForm = (
  t: TFunction,
  vehicles: FleetFormOption[],
  employees: FleetFormOption[],
): FormConfig => ({
  id: "assign-fleet-driver",
  title: t("fleet.lifecycle.assignments.action"),
  description: t("fleet.lifecycle.assignments.description"),
  sections: [{
    id: "assignment",
    fields: [
      { id: "vehicle_id", name: "vehicle_id", type: "select", label: t("fleet.lifecycle.vehicle"), required: true, options: vehicles, width: "1/2" },
      { id: "driver_id", name: "driver_id", type: "select", label: t("fleet.lifecycle.driver"), required: true, options: [{ value: "unassigned", label: t("fleet.lifecycle.assignments.unassign") }, ...employees], width: "1/2" },
    ],
  }],
})

export const recordFleetServiceForm = (
  t: TFunction,
  vehicles: FleetFormOption[],
  serviceTypes: FleetFormOption[],
): FormConfig => ({
  id: "record-fleet-service",
  title: t("fleet.lifecycle.service.action"),
  description: t("fleet.lifecycle.service.description"),
  sections: [{
    id: "service",
    fields: [
      { id: "vehicle_id", name: "vehicle_id", type: "select", label: t("fleet.lifecycle.vehicle"), required: true, options: vehicles, width: "1/2" },
      { id: "service_type_id", name: "service_type_id", type: "select", label: t("fleet.lifecycle.serviceType"), required: true, options: serviceTypes, width: "1/2" },
      optionalDate("serviced_at", t("fleet.lifecycle.servicedAt")),
      { id: "odometer_km", name: "odometer_km", type: "number", label: t("fleet.table.odometer"), min: 0, width: "1/2" },
      { id: "provider", name: "provider", type: "text", label: t("fleet.lifecycle.provider"), width: "full" },
      notesField(t),
    ],
  }],
})

export const recordFleetInspectionForm = (
  t: TFunction,
  vehicles: FleetFormOption[],
  employees: FleetFormOption[],
): FormConfig => ({
  id: "record-fleet-inspection",
  title: t("fleet.lifecycle.inspections.action"),
  description: t("fleet.lifecycle.inspections.description"),
  sections: [{
    id: "inspection",
    fields: [
      { id: "vehicle_id", name: "vehicle_id", type: "select", label: t("fleet.lifecycle.vehicle"), required: true, options: vehicles, width: "1/2" },
      { id: "inspector_id", name: "inspector_id", type: "select", label: t("fleet.lifecycle.inspector"), options: employees, width: "1/2" },
      optionalDate("inspected_at", t("fleet.lifecycle.inspectedAt")),
      { id: "outcome", name: "outcome", type: "select", label: t("fleet.lifecycle.outcome"), required: true, defaultValue: "passed", options: [
        { value: "passed", label: t("fleet.lifecycle.outcomes.passed") },
        { value: "failed", label: t("fleet.lifecycle.outcomes.failed") },
        { value: "attention_required", label: t("fleet.lifecycle.outcomes.attentionRequired") },
      ], width: "1/2" },
      { id: "odometer_km", name: "odometer_km", type: "number", label: t("fleet.table.odometer"), min: 0, width: "1/2" },
      notesField(t),
    ],
  }],
})
