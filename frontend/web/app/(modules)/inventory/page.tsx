import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { InventoryClient } from "./inventory-client"

export default async function InventoryPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) return <InventoryClient />

  const [products, pricelists, uoms] = await serverPrefetchQueryLists(
    session, ["products", "pricelists", "uoms"] as const,
  )
  return (
    <InventoryClient
      initialProducts={products}
      initialPricelists={pricelists}
      initialUoms={uoms}
      organizationId={session.organizationId}
    />
  )
}
