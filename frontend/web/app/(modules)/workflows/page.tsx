import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { WorkflowsClient } from "./workflows-client"

const SSR_RESOURCES = [
  "workflows",
  "workflow-instances",
  "workflow-activities",
  "workflow-workitems",
] as const

export default async function WorkflowsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <WorkflowsClient />
  }

  const [workflows, instances, activities, workitems] =
    await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <WorkflowsClient
      initialWorkflows={workflows}
      initialInstances={instances}
      initialActivities={activities}
      initialWorkitems={workitems}
      organizationId={session.organizationId}
    />
  )
}
