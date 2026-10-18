import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { MessagesClient } from "./messages-client"

const SSR_RESOURCES = ["mail-messages", "mail-followers"] as const

export default async function MessagesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <MessagesClient />
  }

  const [messages, followers] = await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <MessagesClient
      initialMessages={messages}
      initialFollowers={followers}
      organizationId={session.organizationId}
    />
  )
}
