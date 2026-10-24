import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { TasksClient } from "./tasks-client"
import { MyWorkClient } from "./my-work-client"

const SSR_RESOURCES = ["projects", "tasks"] as const

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ source?: string; filter?: string | string[]; tab?: string }> }) {
  const session = await getStdbSession()
  const params = await searchParams
  // Preserve existing deep links into the project-task workspace.
  if (params.source !== "projects" && !params.filter && !params.tab) {
    return <MyWorkClient organizationId={session?.organizationId} />
  }
  if (!session?.organizationId) {
    return <TasksClient />
  }

  const [projects, tasks] = await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <TasksClient
      organizationId={session.organizationId}
      initialProjects={projects}
      initialTasks={tasks}
    />
  )
}
