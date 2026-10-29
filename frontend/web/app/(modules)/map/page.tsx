import { getStdbSession } from "@/lib/api-session"
import { MapClient } from "./map-client"

export default async function MapPage() {
  const session = await getStdbSession()
  const org = session?.organizationId != null ? session.organizationId : undefined
  return <MapClient organizationId={org} />
}
