import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { ProjectsClient } from "./projects-client"

const SSR_RESOURCES = [
  "projects",
  "tasks",
  "timesheets",
  "pricelists",
  "contacts",
] as const

export default async function ProjectsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProjectsClient />
  }

  const [projects, tasks, timesheets, pricelists, contacts] =
    await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <ProjectsClient
      initialProjects={projects}
      initialTasks={tasks}
      initialTimesheets={timesheets}
      initialPricelists={pricelists}
      initialContacts={contacts}
      organizationId={session.organizationId}
    />
  )
}
