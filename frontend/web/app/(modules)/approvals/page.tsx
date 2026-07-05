import { getStdbSession } from "@/lib/api-session"
import { ApprovalsClient } from "./approvals-client"

export default async function ApprovalsPage() {
  const session = await getStdbSession()
  return <ApprovalsClient organizationId={session?.organizationId} />
}
