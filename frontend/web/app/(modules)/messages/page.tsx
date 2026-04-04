import { getStdbSession } from "@/lib/api-session"
import { serverQueryMailMessages } from "@lumiere/stdb/server"
import { MessagesClient } from "./messages-client"

export default async function MessagesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <MessagesClient />
  }
  const { organizationId, opts } = session

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
