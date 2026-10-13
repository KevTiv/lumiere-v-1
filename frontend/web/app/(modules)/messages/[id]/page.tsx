import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { MessagePageClient } from "./message-page-client"

const SSR_RESOURCES = ["mail-messages"] as const

interface MessagePageProps {
  params: Promise<{ id: string }>
}

export default async function MessagePage({ params }: MessagePageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <MessagePageClient messageId={id} />
  }

  const [messages] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return <MessagePageClient messageId={id} initialMessages={messages} organizationId={session.organizationId} />
}
