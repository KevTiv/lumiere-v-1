import { getStdbSession } from "@/lib/api-session"
import { FarmBatchesWorkspace } from "./farm-batches-workspace"

export default async function FarmBatchesPage() {
  const session = await getStdbSession()
  return <FarmBatchesWorkspace organizationId={session?.organizationId} />
}
