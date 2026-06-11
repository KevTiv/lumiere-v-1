import { getStdbSession } from "@/lib/api-session"
import { AiHarnessClient } from "./ai-harness-client"

export default async function AiHarnessPage() {
  const session = await getStdbSession()
  return <AiHarnessClient organizationId={session?.organizationId} />
}
