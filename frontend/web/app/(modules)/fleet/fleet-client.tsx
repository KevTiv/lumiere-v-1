"use client"

import { useTranslation } from "@lumiere/i18n"
import { ModuleView, MissingOrganization } from "@lumiere/ui"
import { fleetModuleConfig } from "@/lib/module-dashboard-configs"
import { useFleetModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  useFleetVehicles,
  useCreateFleetVehicle,
} from "@lumiere/query-hooks/hooks/fleet"
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
  const createVehicle = useCreateFleetVehicle(orgId, company ?? undefined)

  const moduleConfig = fleetModuleConfig(t)
  const vehicleRows = vehicles as unknown as Record<string, unknown>[]

  return (
    <ModuleView
      config={moduleConfig}
      data={{ "fleet-vehicles": vehicleRows }}
      isPending={createVehicle.isPending}
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
