import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState, serverFetchQueryListsRequired } from "@/lib/server-query"
import { ProjectsClient } from "./projects-client"

const SSR_RESOURCES = [
  "projects",
  "tasks",
  "timesheets",
  "pricelists",
] as const

export default async function ProjectsPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProjectsClient />
  }

  const [records, contactsState] = await Promise.all([
    serverFetchQueryListsRequired(session, SSR_RESOURCES),
    serverFetchQueryListState(session, "contacts"),
  ])
  const [projects, tasks, timesheets, pricelists] = records

  return (
    <ProjectsClient
      initialProjects={projects}
      initialTasks={tasks}
      initialTimesheets={timesheets}
      initialPricelists={pricelists}
      initialContactsState={contactsState}
      organizationId={session.organizationId}
    />
  )
}
