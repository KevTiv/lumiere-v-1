import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { VehiclePageClient } from "./vehicle-page-client"

const SSR_RESOURCES = ["fleet-vehicles"] as const

interface VehiclePageProps {
  params: Promise<{ id: string }>
}

export default async function VehiclePage({ params }: VehiclePageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <VehiclePageClient vehicleId={id} />
  }

  const [vehicles] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <VehiclePageClient vehicleId={id} initialVehicles={vehicles} organizationId={session.organizationId} />
  )
}
