import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryLeads,
  serverQueryOpportunities,
  serverQueryContacts,
} from "@lumiere/stdb/server"
import { CrmClient } from "./crm-client"

export default async function CrmPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <CrmClient />
  }
  const { organizationId, opts } = session

  const [leads, opportunities, contacts] = await Promise.all([
    serverQueryLeads(organizationId, opts),
    serverQueryOpportunities(organizationId, opts),
    serverQueryContacts(organizationId, opts),
  ]).catch(() => [[], [], []])

  return (
    <CrmClient
      initialLeads={leads as Record<string, unknown>[]}
      initialOpportunities={opportunities as Record<string, unknown>[]}
      initialContacts={contacts as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
