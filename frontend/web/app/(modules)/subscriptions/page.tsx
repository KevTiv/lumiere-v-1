import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { SubscriptionsClient } from "./subscriptions-client"

const SSR_RESOURCES = [
  // Account and journal projections load after active-company resolution in the browser.
  "subscriptions",
  "subscription-plans",
  "deferred-revenue-schedules",
  "deferred-revenue-lines",
  "revenue-recognition-rules",
  "sale-orders",
  "pricelists",
  "products",
] as const

export default async function SubscriptionsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <SubscriptionsClient />
  }

  const [
    subscriptions,
    plans,
    deferredSchedules,
    deferredLines,
    recognitionRules,
    saleOrders,
    pricelists,
    products,
  ] = await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <SubscriptionsClient
      initialSubscriptions={subscriptions}
      initialPlans={plans}
      initialDeferredSchedules={deferredSchedules}
      initialDeferredLines={deferredLines}
      initialRecognitionRules={recognitionRules}
      initialSaleOrders={saleOrders}
      initialPricelists={pricelists}
      initialProducts={products}
      organizationId={session.organizationId}
    />
  )
}
