import { getStdbSession } from "@/lib/api-session"
import { FarmBatchesWorkspace } from "./farm-batches-workspace"
import { FarmOperationsGate } from "./farm-operations-gate"

export default async function FarmBatchesPage() {
  const session = await getStdbSession()
  return (
    <FarmOperationsGate organizationId={session?.organizationId}>
      <FarmBatchesWorkspace organizationId={session?.organizationId} />
    </FarmOperationsGate>
  )
}
