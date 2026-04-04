import { getStdbSession } from "@/lib/api-session"
import { serverQueryProducts, serverQueryPosTerminals } from "@lumiere/stdb/server"
import { PosClient } from "./pos-client"

export default async function PosPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <PosClient />
  }
  const { organizationId, opts } = session

  const [products, terminals] = await Promise.all([
    serverQueryProducts(organizationId, opts),
    serverQueryPosTerminals(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <PosClient
      initialProducts={products as Record<string, unknown>[]}
      initialTerminals={terminals as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
