import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryMailMessages } from "@lumiere/stdb/server"
import { MessagesClient } from "./messages-client"

export default async function MessagesPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <MessagesClient />
  }

  const [messages] = await Promise.all([
    serverQueryMailMessages(organizationId, opts),
  ]).catch(() => [[]])

  return (
    <MessagesClient
      initialMessages={messages as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
