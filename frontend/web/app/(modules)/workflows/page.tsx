import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryWorkflows, serverQueryWorkflowInstances } from "@lumiere/stdb/server"
import { WorkflowsClient } from "./workflows-client"

export default async function WorkflowsPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <WorkflowsClient />
  }

  const [workflows, instances] = await Promise.all([
    serverQueryWorkflows(organizationId, opts),
    serverQueryWorkflowInstances(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <WorkflowsClient
      initialWorkflows={workflows as Record<string, unknown>[]}
      initialInstances={instances as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
