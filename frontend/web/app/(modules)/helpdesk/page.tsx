import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { HelpdeskClient } from "./helpdesk-client"

const SSR_RESOURCES = [
  "helpdesk-tickets",
  "helpdesk-teams",
  "helpdesk-stages",
  "helpdesk-slas",
] as const

export default async function HelpdeskPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <HelpdeskClient />
  }

  const [tickets, teams, stages, slas] = await serverFetchQueryListsAllowEmpty(
    session,
    SSR_RESOURCES,
  )

  return (
    <HelpdeskClient
      initialTickets={tickets}
      initialTeams={teams}
      initialStages={stages}
      initialSlas={slas}
      organizationId={session.organizationId}
    />
  )
}
