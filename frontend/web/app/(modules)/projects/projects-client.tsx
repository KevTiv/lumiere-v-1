"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { projectsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useProjects,
  useTasks,
  useTimesheets,
  useCreateProject,
  useCreateTask,
} from "@lumiere/stdb"
import type {
  CreateProjectParams,
  CreateTaskParams,
} from "@lumiere/stdb"

interface ProjectsClientProps {
  initialProjects?: Record<string, unknown>[]
  initialTasks?: Record<string, unknown>[]
  initialTimesheets?: Record<string, unknown>[]
  organizationId?: number
}

export function ProjectsClient({
  initialProjects,
  initialTasks,
  initialTimesheets,
  organizationId,
}: ProjectsClientProps) {
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  const { data: projects = [] } = useProjects(companyId, initialProjects)
  const { data: tasks = [] } = useTasks(companyId, initialTasks)
  const { data: timesheets = [] } = useTimesheets(companyId, initialTimesheets)

  const createProject = useCreateProject(orgId, companyId)
  const createTask = useCreateTask(orgId, companyId)

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => String(p.lastUpdateStatus) === "InProgress",
    ).length
    const totalHoursSpent = timesheets.reduce((s, t) => s + Number(t.unitAmount ?? 0), 0)
    const overdueTasks = tasks.filter(
      (t) =>
        t.dateDeadline != null &&
        Number(t.dateDeadline) < Date.now() * 1000 &&
        String(t.kanbanState) !== "Done" &&
        String(t.kanbanState) !== "Cancelled",
    ).length
    const openTasks = tasks.filter(
      (t) => String(t.kanbanState) !== "Done" && String(t.kanbanState) !== "Cancelled",
    ).length

    const dashboardTab = projectsModuleConfig.tabs.find((t) => t.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Active Projects", value: String(activeProjects), icon: "FolderKanban" },
                { label: "Open Tasks", value: String(openTasks), icon: "CheckSquare" },
                { label: "Overdue Tasks", value: String(overdueTasks), icon: "AlertCircle" },
                { label: "Hours Logged", value: `${Math.round(totalHoursSpent)}h`, icon: "Clock" },
              ],
            },
          }
        }
        return w
      }),
    }))
  }, [projects, tasks, timesheets])

  const config = useMemo(
    () => ({
      ...projectsModuleConfig,
      tabs: projectsModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections],
  )

  const data = useMemo(
    () => ({
      projects: projects as unknown as Record<string, unknown>[],
      tasks: tasks as unknown as Record<string, unknown>[],
      timesheets: timesheets as unknown as Record<string, unknown>[],
    }),
    [projects, tasks, timesheets],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createProject") {
      createProject.mutate(formData as unknown as CreateProjectParams)
    } else if (action === "createTask") {
      createTask.mutate(formData as unknown as CreateTaskParams)
    }
  }

  return (
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
