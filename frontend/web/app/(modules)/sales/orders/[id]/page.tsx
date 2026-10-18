import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { SaleOrderPageClient } from "./order-page-client"

const SSR_RESOURCES = ["sale-orders", "sale-order-lines", "stock-pickings", "contacts"] as const

interface SaleOrderPageProps {
  params: Promise<{ id: string }>
}

export default async function SaleOrderPage({ params }: SaleOrderPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <SaleOrderPageClient orderId={id} />
  }

  const [orders, orderLines, stockPickings, contacts] = await serverFetchQueryListsRequired(
    session,
    SSR_RESOURCES,
  )

  return (
    <SaleOrderPageClient
      orderId={id}
      initialOrders={orders}
      initialOrderLines={orderLines}
      initialStockPickings={stockPickings}
      initialContacts={contacts}
      organizationId={session.organizationId}
    />
  )
}
