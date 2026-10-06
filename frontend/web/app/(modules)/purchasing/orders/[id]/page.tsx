import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { PurchaseOrderPageClient } from "./order-page-client"

const SSR_RESOURCES = ["purchase-orders", "purchase-order-lines", "stock-pickings", "contacts"] as const

interface PurchaseOrderPageProps {
  params: Promise<{ id: string }>
}

export default async function PurchaseOrderPage({ params }: PurchaseOrderPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <PurchaseOrderPageClient orderId={id} />
  }

  const [orders, orderLines, stockPickings, contacts] = await serverFetchQueryListsRequired(
    session,
    SSR_RESOURCES,
  )

  return (
    <PurchaseOrderPageClient
      orderId={id}
      initialOrders={orders}
      initialOrderLines={orderLines}
      initialStockPickings={stockPickings}
      initialContacts={contacts}
      organizationId={session.organizationId}
    />
  )
}
