import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { WorkflowsClient } from "./workflows-client"

const SSR_RESOURCES = ["workflows", "workflow-versions", "workflow-instances"] as const

export default async function WorkflowsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <WorkflowsClient />
  }

  const [workflows, versions, instances] = await serverFetchQueryListsAllowEmpty(
    session,
    SSR_RESOURCES,
  )

  return (
    <WorkflowsClient
      initialWorkflows={workflows}
      initialVersions={versions}
      initialInstances={instances}
      organizationId={session.organizationId}
    />
  )
}
