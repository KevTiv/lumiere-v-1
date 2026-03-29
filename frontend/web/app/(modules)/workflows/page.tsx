import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryWorkflows,
  serverQueryWorkflowInstances,
  serverQueryWorkflowActivities,
  serverQueryWorkflowWorkitems,
} from "@lumiere/stdb/server"
import { WorkflowsClient } from "./workflows-client"

export default async function WorkflowsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <WorkflowsClient />
  }
  const { organizationId, opts } = session

  const [workflows, instances, activities, workitems] = await Promise.all([
    serverQueryWorkflows(organizationId, opts),
    serverQueryWorkflowInstances(organizationId, opts),
    serverQueryWorkflowActivities(organizationId, opts),
    serverQueryWorkflowWorkitems(organizationId, opts),
  ]).catch(() => [[], [], [], []])

  return (
    <WorkflowsClient
      initialWorkflows={workflows as Record<string, unknown>[]}
      initialInstances={instances as Record<string, unknown>[]}
      initialActivities={activities as Record<string, unknown>[]}
      initialWorkitems={workitems as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
