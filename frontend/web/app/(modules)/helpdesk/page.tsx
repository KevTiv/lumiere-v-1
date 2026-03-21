import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryHelpdeskTickets } from "@lumiere/stdb/server"
import { HelpdeskClient } from "./helpdesk-client"

export default async function HelpdeskPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <HelpdeskClient />
  }

  const [tickets] = await Promise.all([
    serverQueryHelpdeskTickets(organizationId, opts),
  ]).catch(() => [[]])

  return (
    <HelpdeskClient
      initialTickets={tickets as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
