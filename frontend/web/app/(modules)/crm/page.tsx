import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { CrmClient } from "./crm-client"

const SSR_RESOURCES = ["leads", "opportunities", "contacts"] as const

export default async function CrmPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <CrmClient />
  }

  const [leads, opportunities, contacts] = await serverFetchQueryListsAllowEmpty(
    session,
    SSR_RESOURCES,
  )

  return (
    <CrmClient
      initialLeads={leads}
      initialOpportunities={opportunities}
      initialContacts={contacts}
      organizationId={session.organizationId}
    />
  )
}
