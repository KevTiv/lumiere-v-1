import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { ManufacturingOrderPageClient } from "./order-page-client"

const SSR_RESOURCES = ["mrp-productions", "mrp-workorders", "mrp-workcenters", "products"] as const

interface ManufacturingOrderPageProps {
  params: Promise<{ id: string }>
}

export default async function ManufacturingOrderPage({ params }: ManufacturingOrderPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ManufacturingOrderPageClient orderId={id} />
  }

  const [productions, workorders, workcenters, products] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <ManufacturingOrderPageClient
      orderId={id}
      initialProductions={productions}
      initialWorkorders={workorders}
      initialWorkcenters={workcenters}
      initialProducts={products}
      organizationId={session.organizationId}
    />
  )
}
