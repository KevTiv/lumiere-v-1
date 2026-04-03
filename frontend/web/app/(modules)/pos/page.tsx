import { getStdbSession } from "@/lib/api-session"
import { serverQueryProducts, serverQueryPosTerminals } from "@lumiere/stdb/server"
import { PosClient } from "./pos-client"

export default async function PosPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <PosClient />
  }

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
