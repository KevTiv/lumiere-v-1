import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { PosSessionPageClient } from "./session-page-client"

const SSR_RESOURCES = ["pos-sessions", "pos-configs"] as const

interface PosSessionPageProps {
  params: Promise<{ id: string }>
}

export default async function PosSessionPage({ params }: PosSessionPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <PosSessionPageClient sessionId={id} />
  }

  const [sessions, configs] = await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <PosSessionPageClient
      sessionId={id}
      initialSessions={sessions}
      initialConfigs={configs}
      organizationId={session.organizationId}
    />
  )
}
