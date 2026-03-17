import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryMrpProductions,
  serverQueryMrpBoms,
  serverQueryMrpWorkorders,
  serverQueryMrpWorkcenters,
} from "@lumiere/stdb/server"
import { ManufacturingClient } from "./manufacturing-client"

export default async function ManufacturingPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <ManufacturingClient />
  }

  const [productions, boms, workorders, workcenters] = await Promise.all([
    serverQueryMrpProductions(organizationId, opts),
    serverQueryMrpBoms(organizationId, opts),
    serverQueryMrpWorkorders(organizationId, opts),
    serverQueryMrpWorkcenters(organizationId, opts),
  ]).catch(() => [[], [], [], []])

  return (
    <ManufacturingClient
      initialProductions={productions as Record<string, unknown>[]}
      initialBoms={boms as Record<string, unknown>[]}
      initialWorkorders={workorders as Record<string, unknown>[]}
      initialWorkcenters={workcenters as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
