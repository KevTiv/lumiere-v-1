import { getStdbSession } from "@/lib/api-session"
import { serverQueryMailFollowers, serverQueryMailMessages } from "@lumiere/stdb/server"
import { MessagesClient } from "./messages-client"

export default async function MessagesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <MessagesClient />
  }
  const { organizationId, opts } = session

  const [messages, followers] = await Promise.all([
    serverQueryMailMessages(organizationId, opts),
    serverQueryMailFollowers(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <MessagesClient
      initialMessages={messages as Record<string, unknown>[]}
      initialFollowers={followers as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
