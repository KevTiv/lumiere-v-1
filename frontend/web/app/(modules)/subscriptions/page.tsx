import { getStdbSession } from "@/lib/api-session"
import {
  serverQuerySubscriptions,
  serverQuerySubscriptionPlans,
  serverQueryDeferredRevenueSchedules,
  serverQueryDeferredRevenueLines,
  serverQueryRevenueRecognitionRules,
  serverQuerySaleOrders,
  serverQueryPricelists,
  serverQueryProducts,
  serverQueryAccountJournals,
  serverQueryAccountAccounts,
} from "@lumiere/stdb/server"
import { SubscriptionsClient } from "./subscriptions-client"

export default async function SubscriptionsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <SubscriptionsClient />
  }
  const { organizationId, opts } = session

  const [
    subscriptions,
    plans,
    deferredSchedules,
    deferredLines,
    recognitionRules,
    saleOrders,
    pricelists,
    products,
    journals,
    accounts,
  ] = await Promise.all([
    serverQuerySubscriptions(organizationId, opts),
    serverQuerySubscriptionPlans(organizationId, opts),
    serverQueryDeferredRevenueSchedules(organizationId, opts),
    serverQueryDeferredRevenueLines(organizationId, opts),
    serverQueryRevenueRecognitionRules(organizationId, opts),
    serverQuerySaleOrders(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryProducts(organizationId, opts),
    serverQueryAccountJournals(organizationId, opts),
    serverQueryAccountAccounts(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], [], [], [], []])

  return (
    <SubscriptionsClient
      initialSubscriptions={subscriptions as Record<string, unknown>[]}
      initialPlans={plans as Record<string, unknown>[]}
      initialDeferredSchedules={deferredSchedules as Record<string, unknown>[]}
      initialDeferredLines={deferredLines as Record<string, unknown>[]}
      initialRecognitionRules={recognitionRules as Record<string, unknown>[]}
      initialSaleOrders={saleOrders as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      initialProducts={products as Record<string, unknown>[]}
      initialJournals={journals as Record<string, unknown>[]}
      initialAccounts={accounts as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
