import { getStdbSession } from "@/lib/api-session"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  const session = await getStdbSession()
  return <SettingsClient organizationId={session?.organizationId} />
}
