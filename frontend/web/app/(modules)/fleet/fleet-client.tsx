"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, MissingOrganization, type EntityRow, type ModuleConfig } from "@lumiere/ui"
import { fleetModuleConfig } from "@/lib/module-dashboard-configs"
import { useFleetModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  useFleetVehicles,
  useFleetServiceTypes,
  useFleetServiceRecords,
  useFleetInspections,
} from "@lumiere/query-hooks/hooks/fleet"
import { fleetVehicleRecordHref, showVehicleNameColumn, withVehicleNames } from "./fleet-record"
import { useFleetActions } from "./fleet-actions"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr/employees"
import {
  useAccountAccounts,
  useAccountJournals,
} from "@lumiere/query-hooks/hooks/accounting"
import {
  accountAccountRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
} from "@/lib/form-lookup"
import type { FleetVehicle } from "@lumiere/stdb/types"

interface FleetClientProps {
  initialVehicles?: FleetVehicle[]
  organizationId?: number
}

type FleetClientLoadedProps = Omit<FleetClientProps, "organizationId"> & {
  organizationId: number
}

const withVehicleNameColumn = <Tab extends ModuleConfig["tabs"][number]>(tab: Tab): Tab => {
  const entityConfig = tab.entityConfig
  if (!entityConfig || entityConfig.view.mode !== "table") return tab
  return {
    ...tab,
    entityConfig: {
      ...entityConfig,
      view: { ...entityConfig.view, columns: showVehicleNameColumn(entityConfig.view.columns) },
    },
  }
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
  const { data: accountJournals = [] } = useAccountJournals(orgId)
  const { data: accountAccounts = [] } = useAccountAccounts(orgId)
  const fleetActions = useFleetActions(orgId, company ?? undefined)

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
  const journalRows = (accountJournals as unknown as EntityRow[]).filter((row) =>
    belongsToCompany(row),
  )
  const accountRows = (accountAccounts as unknown as EntityRow[]).filter((row) =>
    belongsToCompany(row),
  )

  const moduleConfig = useMemo(() => {
    const rowId = (row: EntityRow) => String(row.id ?? "")
    const rowLabel = (row: EntityRow, fallback: string) =>
      String(row.name ?? row.display_name ?? row.displayName ?? fallback)
    return fleetModuleConfig(t, {
      vehicles: vehicleRows.map((row) => ({ value: rowId(row), label: rowLabel(row, `Vehicle ${rowId(row)}`) })),
      employees: employeeRows.map((row) => ({ value: rowId(row), label: rowLabel(row, `Employee ${rowId(row)}`) })),
      serviceTypes: serviceTypeRows.map((row) => ({ value: rowId(row), label: rowLabel(row, `Service type ${rowId(row)}`) })),
      journals: accountJournalRowsToSelectOptions(journalRows),
      accounts: accountAccountRowsToSelectOptions(accountRows),
    })
  }, [accountRows, employeeRows, journalRows, serviceTypeRows, t, vehicleRows])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "fleet-service-records" || tab.id === "fleet-inspections"
          ? withVehicleNameColumn(tab)
          : tab.id === "fleet-vehicles"
          ? {
              ...tab,
              recordSheet: {
                titleKey: "name",
                auditTableName: "fleet_vehicle",
                discussion: {},
                openHref: fleetVehicleRecordHref,
                detailConfig: {
                  mode: "detail" as const,
                  sections: [
                    {
                      id: "vehicle",
                      fields: [
                        { key: "license_plate", label: t("fleet.table.licensePlate") },
                        { key: "vehicle_type", label: t("fleet.table.vehicleType") },
                        { key: "driver_name", label: t("fleet.table.driverName") },
                        { key: "status", label: t("fleet.table.status") },
                        { key: "odometer_km", label: t("fleet.table.odometer") },
                      ],
                    },
                  ],
                },
              },
            }
          : tab,
      ),
    }),
    [moduleConfig, t],
  )

  return (
    <ModuleView
      config={config}
      data={{
        "fleet-vehicles": vehicleRows,
        "fleet-driver-assignment": vehicleRows,
        "fleet-service-records": withVehicleNames(serviceRecordRows as unknown as EntityRow[], vehicleRows),
        "fleet-inspections": withVehicleNames(inspectionRows as unknown as EntityRow[], vehicleRows),
      }}
      isPending={fleetActions.isPending}
      onFormSubmit={async (_tabId, action, formData) => {
        await fleetActions.submit(action, formData)
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
