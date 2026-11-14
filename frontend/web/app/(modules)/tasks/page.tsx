import { getStdbSession } from "@/lib/api-session"
import { serverPrefetchQueryLists } from "@/lib/server-query"
import { TasksClient } from "./tasks-client"
import { MyWorkClient } from "./my-work-client"

const SSR_RESOURCES = ["projects", "tasks"] as const

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ source?: string; filter?: string | string[]; tab?: string; taskId?: string; taskCompany?: string; taskView?: string }> }) {
  const session = await getStdbSession()
  const params = await searchParams
  // Preserve existing deep links into the project-task workspace.
  if (params.source !== "projects" && params.taskId === undefined && params.taskCompany === undefined && !params.filter && !params.tab) {
    return <MyWorkClient organizationId={session?.organizationId} />
  }
  if (!session?.organizationId) {
    return <TasksClient />
  }

  const taskLink = params.taskId !== undefined || params.taskCompany !== undefined
    ? {
        id: params.taskId,
        companyId: params.taskCompany,
        view: params.taskView === "edit" || params.taskView === "assign" ? params.taskView : undefined,
      } as const
    : undefined
  const [projects, tasks] = taskLink ? [] : await serverPrefetchQueryLists(session, SSR_RESOURCES)

  return (
    <TasksClient
      organizationId={session.organizationId}
      initialProjects={projects}
      initialTasks={tasks}
      taskLink={taskLink}
    />
  )
}
