import { getStdbSession } from "@/lib/api-session"
import { isFirstTestOrganization } from "@/lib/first-org-exposure"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>
}) {
  const session = await getStdbSession()
  const params = await searchParams
  const firstOrgProfile = isFirstTestOrganization(session?.organizationId)
  return (
    <SettingsClient
      organizationId={session?.organizationId}
      firstOrgProfile={firstOrgProfile}
      financeSetup={firstOrgProfile && params.section === "finance-setup"}
    />
  )
}
