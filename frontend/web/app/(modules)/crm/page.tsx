import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryLeads,
  serverQueryOpportunities,
  serverQueryContacts,
} from "@lumiere/stdb/server"
import { CrmClient } from "./crm-client"

export default async function CrmPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <CrmClient />
  }

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
