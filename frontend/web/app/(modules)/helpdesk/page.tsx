import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryHelpdeskTickets,
  serverQueryHelpdeskTeams,
  serverQueryHelpdeskStages,
  serverQueryHelpdeskSlas,
} from "@lumiere/stdb/server"
import { HelpdeskClient } from "./helpdesk-client"

export default async function HelpdeskPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <HelpdeskClient />
  }

  const [tickets, teams, stages, slas] = await Promise.all([
    serverQueryHelpdeskTickets(organizationId, opts),
    serverQueryHelpdeskTeams(organizationId, opts),
    serverQueryHelpdeskStages(organizationId, opts),
    serverQueryHelpdeskSlas(organizationId, opts),
  ]).catch(() => [[], [], [], []])

  return (
    <HelpdeskClient
      initialTickets={tickets as Record<string, unknown>[]}
      initialTeams={teams as Record<string, unknown>[]}
      initialStages={stages as Record<string, unknown>[]}
      initialSlas={slas as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
