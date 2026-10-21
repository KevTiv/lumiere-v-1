import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { SubscriptionPageClient } from "./subscription-page-client"

const SSR_RESOURCES = ["subscriptions"] as const

interface SubscriptionPageProps {
  params: Promise<{ id: string }>
}

export default async function SubscriptionPage({ params }: SubscriptionPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <SubscriptionPageClient subscriptionId={id} />
  }

  const [subscriptions] = await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <SubscriptionPageClient
      subscriptionId={id}
      initialSubscriptions={subscriptions}
      organizationId={session.organizationId}
    />
  )
}
