import { getStdbSession } from "@/lib/api-session"
import { AiActionDraftsClient } from "./ai-action-drafts-client"

export default async function AiActionDraftsPage() {
  const session = await getStdbSession()
  return <AiActionDraftsClient organizationId={session?.organizationId} />
}
