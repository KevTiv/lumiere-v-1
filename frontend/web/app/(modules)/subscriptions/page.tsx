import { getStdbSession } from "@/lib/stdb-session"
import { serverQuerySubscriptions, serverQuerySubscriptionPlans } from "@lumiere/stdb/server"
import { SubscriptionsClient } from "./subscriptions-client"

export default async function SubscriptionsPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <SubscriptionsClient />
  }

  const [subscriptions, plans] = await Promise.all([
    serverQuerySubscriptions(organizationId, opts),
    serverQuerySubscriptionPlans(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <SubscriptionsClient
      initialSubscriptions={subscriptions as Record<string, unknown>[]}
      initialPlans={plans as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
