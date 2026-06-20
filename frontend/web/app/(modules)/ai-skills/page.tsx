import { getStdbSession } from "@/lib/api-session"
import { AiSkillsClient } from "./ai-skills-client"

export default async function AiSkillsPage() {
  const session = await getStdbSession()
  return <AiSkillsClient organizationId={session?.organizationId} />
}
