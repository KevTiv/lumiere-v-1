import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { FleetClient } from "./fleet-client"

const SSR_RESOURCES = ["fleet-vehicles"] as const

export default async function FleetPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <FleetClient />
  }

  const [vehicles] = await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <FleetClient
      initialVehicles={vehicles}
      organizationId={session.organizationId}
    />
  )
}
