"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newProjectForm, newTaskForm } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { projectsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useProjects,
  useTasks,
  useTimesheets,
  useEmployees,
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
  const { t } = useTranslation()
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: projects = [] } = useProjects(companyId, initialProjects)
  const { data: tasks = [] } = useTasks(companyId, initialTasks)
  const { data: timesheets = [] } = useTimesheets(companyId, initialTimesheets)
  const { data: employees = [] } = useEmployees(companyId)

  const createProject = useCreateProject(orgId, companyId)
  const createTask = useCreateTask(orgId, companyId)

  const moduleConfig = useMemo(() => projectsModuleConfig(t), [t])

  // Live KPI overrides
  const liveSections = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => String(p.lastUpdateStatus) === "InProgress",
    ).length
    const totalHoursSpent = timesheets.reduce((s, ts) => s + Number(ts.unitAmount ?? 0), 0)
    const overdueTasks = tasks.filter(
      (task) =>
        task.dateDeadline != null &&
        Number(task.dateDeadline) < Date.now() * 1000 &&
        String(task.kanbanState) !== "Done" &&
        String(task.kanbanState) !== "Cancelled",
    ).length
    const openTasks = tasks.filter(
      (task) => String(task.kanbanState) !== "Done" && String(task.kanbanState) !== "Cancelled",
    ).length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
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
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_project: () => setQuickActionForm({ form: newProjectForm(t), action: "createProject" }),
            create_task: () => setQuickActionForm({ form: newTaskForm(t), action: "createTask" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "proj-progress-bars") {
          const colors = ["#6366f1", "#22c55e", "#f59e0b", "#6366f1", "#8b5cf6"]
          const metrics = projects.slice(0, 5).map((p, i) => {
            const total = Number(p.taskCount ?? 0)
            const closed = Number(p.taskCountClosed ?? 0)
            const progress = total > 0 ? Math.round((closed / total) * 100) : 0
            return {
              label: String(p.name ?? `Project ${i + 1}`),
              value: progress,
              max: 100,
              color: colors[i] ?? "#6366f1",
            }
          })
          return { ...w, data: { metrics } }
        }
        if (w.id === "proj-milestones-table") {
          const nowMs = Date.now()
          const fourteenDaysMs = nowMs + 14 * 86400000
          const upcomingTasks = tasks
            .filter((t) => {
              if (t.isClosed) return false
              const deadlineMs = Number(t.dateDeadline ?? 0) / 1000
              return deadlineMs > nowMs && deadlineMs <= fourteenDaysMs
            })
            .sort((a, b) => Number(a.dateDeadline ?? 0) - Number(b.dateDeadline ?? 0))
            .slice(0, 5)
            .map((t) => {
              const deadlineMs = Number(t.dateDeadline ?? 0) / 1000
              const dueStr = new Date(deadlineMs).toLocaleDateString("en", { month: "short", day: "numeric" })
              const proj = projects.find((p) => p.id === t.projectId)
              return {
                milestone: String(t.name ?? ""),
                project: String(proj?.name ?? "—"),
                owner: "—",
                due: dueStr,
                status: String(t.state ?? "Open"),
              }
            })
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows: upcomingTasks } }
        }
        return w
      }),
    }))
  }, [projects, tasks, timesheets, t, moduleConfig])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }) as ModuleConfig,
    [moduleConfig, liveSections],
  )

  const data = useMemo(
    () => ({
      projects: projects as unknown as Record<string, unknown>[],
      tasks: tasks as unknown as Record<string, unknown>[],
      timesheets: timesheets as unknown as Record<string, unknown>[],
      resources: employees as unknown as Record<string, unknown>[],
    }),
    [projects, tasks, timesheets, employees],
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
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newProjectForm(t)}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
