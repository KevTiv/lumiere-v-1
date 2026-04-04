import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryProjects,
  serverQueryTasks,
  serverQueryTimesheets,
  serverQueryPricelists,
  serverQueryContacts,
} from "@lumiere/stdb/server"
import { ProjectsClient } from "./projects-client"

export default async function ProjectsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProjectsClient />
  }
  const { organizationId, opts } = session

  const [projects, tasks, timesheets, pricelists, contacts] = await Promise.all([
    serverQueryProjects(organizationId, opts),
    serverQueryTasks(organizationId, opts),
    serverQueryTimesheets(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryContacts(organizationId, opts),
  ]).catch(() => [[], [], [], [], []])

  return (
    <ProjectsClient
      initialProjects={projects as Record<string, unknown>[]}
      initialTasks={tasks as Record<string, unknown>[]}
      initialTimesheets={timesheets as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      initialContacts={contacts as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
