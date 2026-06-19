import { getStdbSession } from "@/lib/api-session"
import { serverQueryProjects, serverQueryTasks } from "@lumiere/stdb/server"
import { TasksClient } from "./tasks-client"

export default async function TasksPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <TasksClient />
  }
  const { organizationId, opts } = session

  const [projects, tasks] = await Promise.all([
    serverQueryProjects(organizationId, opts),
    serverQueryTasks(organizationId, opts),
  ]).catch(() => [[], []])

  return (
    <TasksClient
      organizationId={organizationId}
      initialProjects={projects as Record<string, unknown>[]}
      initialTasks={tasks as Record<string, unknown>[]}
    />
  )
}
