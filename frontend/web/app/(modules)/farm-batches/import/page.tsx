import { getStdbSession } from "@/lib/api-session"
import { FarmImportWorkspace } from "./farm-import-workspace"

export default async function FarmImportPage() {
  const session = await getStdbSession()
  return <FarmImportWorkspace organizationId={session?.organizationId} />
}
