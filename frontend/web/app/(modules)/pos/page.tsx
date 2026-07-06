import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { PosClient } from "./pos-client"

const SSR_RESOURCES = [
  "products",
  "pos-terminals",
  "pos-configs",
  "pos-sessions",
] as const

export default async function PosPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <PosClient />
  }

  const [products, terminals, configs, sessions] = await serverFetchQueryListsAllowEmpty(
    session,
    SSR_RESOURCES,
  )

  return (
    <PosClient
      initialProducts={products}
      initialTerminals={terminals}
      initialConfigs={configs}
      initialSessions={sessions}
      organizationId={session.organizationId}
    />
  )
}
