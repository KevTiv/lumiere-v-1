import { getStdbSession } from "@/lib/stdb-session"
import { MapClient } from "./map-client"

export const metadata = {
  title: "Map Overview",
}

export default async function MapPage() {
  const { organizationId } = await getStdbSession()
  return <MapClient organizationId={organizationId ?? 1} />
}
