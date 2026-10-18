import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { TasksClient } from "./tasks-client"

const SSR_RESOURCES = ["projects", "tasks"] as const

export default async function TasksPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <TasksClient />
  }

  const [projects, tasks] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <TasksClient
      organizationId={session.organizationId}
      initialProjects={projects}
      initialTasks={tasks}
    />
  )
}
