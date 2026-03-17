import { getStdbSession } from "@/lib/stdb-session"
import {
  serverQueryProjects,
  serverQueryTasks,
  serverQueryTimesheets,
} from "@lumiere/stdb/server"
import { ProjectsClient } from "./projects-client"

export default async function ProjectsPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <ProjectsClient />
  }

  const [projects, tasks, timesheets] = await Promise.all([
    serverQueryProjects(organizationId, opts),
    serverQueryTasks(organizationId, opts),
    serverQueryTimesheets(organizationId, opts),
  ]).catch(() => [[], [], []])

  return (
    <ProjectsClient
      initialProjects={projects as Record<string, unknown>[]}
      initialTasks={tasks as Record<string, unknown>[]}
      initialTimesheets={timesheets as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}
