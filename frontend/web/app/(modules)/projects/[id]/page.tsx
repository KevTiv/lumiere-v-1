import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { ProjectPageClient } from "./project-page-client"

const SSR_RESOURCES = ["projects", "tasks", "timesheets", "pricelists"] as const

interface ProjectPageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <ProjectPageClient projectId={id} />
  }

  const [projects, tasks, timesheets, pricelists] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return (
    <ProjectPageClient
      projectId={id}
      initialProjects={projects}
      initialTasks={tasks}
      initialTimesheets={timesheets}
      initialPricelists={pricelists}
      organizationId={session.organizationId}
    />
  )
}
