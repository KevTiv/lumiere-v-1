"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, MissingOrganization, type EntityRow } from "@lumiere/ui"
import { fleetModuleConfig } from "@/lib/module-dashboard-configs"
import { useFleetModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  useFleetVehicles,
  useCreateFleetVehicle,
  useFleetServiceTypes,
  useFleetServiceRecords,
  useFleetInspections,
  useUpdateFleetVehicleDriver,
  useRecordFleetService,
  useRecordFleetInspection,
  type FleetInspectionOutcome,
} from "@lumiere/query-hooks/hooks/fleet"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr/employees"
import type { FleetVehicle } from "@lumiere/stdb/types"

interface FleetClientProps {
  initialVehicles?: FleetVehicle[]
  organizationId?: number
}

type FleetClientLoadedProps = Omit<FleetClientProps, "organizationId"> & {
  organizationId: number
}

function FleetClientLoaded({ initialVehicles, organizationId }: FleetClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const company = useOperatingCompanyBigInt()

  useFleetModuleSubscription()

  const { data: vehicles = initialVehicles ?? [] } = useFleetVehicles(orgId, initialVehicles)
  const { data: employees = [] } = useEmployees(orgId)
  const { data: serviceTypes = [] } = useFleetServiceTypes(orgId)
  const { data: serviceRecords = [] } = useFleetServiceRecords(orgId)
  const { data: inspections = [] } = useFleetInspections(orgId)
  const createVehicle = useCreateFleetVehicle(orgId, company ?? undefined)
  const updateDriver = useUpdateFleetVehicleDriver(orgId, company ?? undefined)
  const recordService = useRecordFleetService(orgId, company ?? undefined)
  const recordInspection = useRecordFleetInspection(orgId, company ?? undefined)

  const belongsToCompany = (row: EntityRow, allowOrganizationWide = false) => {
    if (company == null) return true
    const rowCompany = row.company_id ?? row.companyId
    if (allowOrganizationWide && rowCompany == null) return true
    return String(rowCompany ?? "") === company.toString()
  }
  const vehicleRows = (vehicles as unknown as EntityRow[]).filter((row) =>
    belongsToCompany(row),
  )
  const employeeRows = (employees as unknown as EntityRow[]).filter((row) =>
    belongsToCompany(row),
  )
  const serviceTypeRows = serviceTypes.filter((row) => belongsToCompany(row, true))
  const serviceRecordRows = serviceRecords.filter((row) => belongsToCompany(row))
  const inspectionRows = inspections.filter((row) => belongsToCompany(row))

  const moduleConfig = useMemo(() => {
    const rowId = (row: EntityRow) => String(row.id ?? "")
    const rowLabel = (row: EntityRow, fallback: string) =>
      String(row.name ?? row.display_name ?? row.displayName ?? fallback)
    return fleetModuleConfig(t, {
      vehicles: vehicleRows.map((row) => ({ value: rowId(row), label: rowLabel(row, `Vehicle ${rowId(row)}`) })),
      employees: employeeRows.map((row) => ({ value: rowId(row), label: rowLabel(row, `Employee ${rowId(row)}`) })),
      serviceTypes: serviceTypeRows.map((row) => ({ value: rowId(row), label: rowLabel(row, `Service type ${rowId(row)}`) })),
    })
  }, [employeeRows, serviceTypeRows, t, vehicleRows])

  const optionalDate = (value: unknown) => {
    if (value == null || String(value).trim() === "") return undefined
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  const optionalNumber = (value: unknown) => {
    if (value == null || String(value).trim() === "") return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const requestId = () => crypto.randomUUID()

  return (
    <ModuleView
      config={moduleConfig}
      data={{
        "fleet-vehicles": vehicleRows,
        "fleet-driver-assignment": vehicleRows,
        "fleet-service-records": serviceRecordRows,
        "fleet-inspections": inspectionRows,
      }}
      isPending={
        createVehicle.isPending ||
        updateDriver.isPending ||
        recordService.isPending ||
        recordInspection.isPending
      }
      onFormSubmit={async (_tabId, action, formData) => {
        if (action === "createFleetVehicle") {
          await createVehicle.mutateAsync({
            name: String(formData.name ?? ""),
            vehicleType: String(formData.vehicle_type ?? "truck"),
            licensePlate:
              formData.license_plate != null &&
              String(formData.license_plate).trim() !== ""
                ? String(formData.license_plate).trim()
                : null,
            driverName:
              formData.driver_name != null &&
              String(formData.driver_name).trim() !== ""
                ? String(formData.driver_name).trim()
                : null,
          })
          return
        }
        if (action === "assignFleetDriver") {
          const driverId = String(formData.driver_id ?? "")
          await updateDriver.mutateAsync({
            vehicleId: BigInt(String(formData.vehicle_id)),
            driverId: driverId === "unassigned" ? null : BigInt(driverId),
          })
          return
        }
        if (action === "recordFleetService") {
          await recordService.mutateAsync({
            vehicleId: BigInt(String(formData.vehicle_id)),
            serviceTypeId: BigInt(String(formData.service_type_id)),
            servicedAt: optionalDate(formData.serviced_at),
            odometerKm: optionalNumber(formData.odometer_km),
            provider: String(formData.provider ?? ""),
            notes: String(formData.notes ?? ""),
            clientRequestId: requestId(),
          })
          return
        }
        if (action === "recordFleetInspection") {
          const inspectorId = String(formData.inspector_id ?? "").trim()
          await recordInspection.mutateAsync({
            vehicleId: BigInt(String(formData.vehicle_id)),
            inspectorId: inspectorId ? BigInt(inspectorId) : undefined,
            inspectedAt: optionalDate(formData.inspected_at),
            outcome: String(formData.outcome ?? "passed") as FleetInspectionOutcome,
            odometerKm: optionalNumber(formData.odometer_km),
            notes: String(formData.notes ?? ""),
            clientRequestId: requestId(),
          })
        }
      }}
    />
  )
}

export function FleetClient({ initialVehicles, organizationId }: FleetClientProps) {
  if (!hasValidOrganizationId(organizationId)) {
    return <MissingOrganization />
  }
  return (
    <FleetClientLoaded
      initialVehicles={initialVehicles}
      organizationId={organizationId}
    />
  )
}
