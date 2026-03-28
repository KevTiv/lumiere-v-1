import { getStdbSession } from "@/lib/api-session"
import { MapClient } from "./map-client"

export const metadata = {
  title: "Map Overview",
}

export default async function MapPage() {
  const { organizationId } = await getStdbSession()
  const org = organizationId != null ? organizationId : undefined
  return <MapClient organizationId={org} />
}
