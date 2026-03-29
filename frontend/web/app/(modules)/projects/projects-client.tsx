"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newProjectForm,
  newTaskForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  projectsParamsToJson,
  toCreateProjectParams,
  toCreateTaskParams,
} from "@/lib/projects-create-params"
import { projectsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useProjects,
  useTasks,
  useTimesheets,
  useCreateProject,
  useCreateTask,
  useEmployees,
} from "@/hooks/projects"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { usePricelists } from "@/hooks/sales"
import { useContacts } from "@/hooks/crm"
import {
  pricelistRowsToSelectOptions,
  contactRowsToPartnerSelectOptions,
  projectRowsToSelectOptions,
  taskStagePairOptionsFromTasks,
} from "@/lib/form-lookup"

interface ProjectsClientProps {
  initialProjects?: Record<string, unknown>[]
  initialTasks?: Record<string, unknown>[]
  initialTimesheets?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialContacts?: Record<string, unknown>[]
  organizationId?: number
}

type ProjectsClientLoadedProps = Omit<ProjectsClientProps, "organizationId"> & {
  organizationId: number
}

export function ProjectsClient(props: ProjectsClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <ProjectsClientLoaded {...props} organizationId={props.organizationId} />
}

function ProjectsClientLoaded({
  initialProjects,
  initialTasks,
  initialTimesheets,
  initialPricelists,
  initialContacts,
  organizationId,
}: ProjectsClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: projects = [] } = useProjects(companyId, initialProjects)
  const { data: tasks = [] } = useTasks(companyId, initialTasks)
  const { data: timesheets = [] } = useTimesheets(companyId, initialTimesheets)
  const { data: employees = [] } = useEmployees(companyId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: contacts = [] } = useContacts(companyId, initialContacts)

  const createProject = useCreateProject(orgId, companyId)
  const createTask = useCreateTask(orgId, companyId)

  const moduleConfig = useMemo(() => projectsModuleConfig(t), [t])

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const partnerFieldOptions = useMemo(() => {
    const fromApi = contactRowsToPartnerSelectOptions(contacts)
    const optional = { value: "", label: "—" }
    if (fromApi.length > 0) return [optional, ...fromApi]
    return [{ value: "", label: t("common.lookup.noPartners"), disabled: true }]
  }, [contacts, t])

  const projectFieldOptions = useMemo(() => {
    const fromApi = projectRowsToSelectOptions(projects)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noProjects"), disabled: true }]
  }, [projects, t])

  const taskStageFieldOptions = useMemo(() => {
    const optional = { value: "", label: "—" }
    const fromPairs = taskStagePairOptionsFromTasks(
      tasks as Record<string, unknown>[],
      projects as Record<string, unknown>[],
    )
    if (fromPairs.length > 0) return [optional, ...fromPairs]
    return [{ value: "", label: t("common.lookup.noTaskStages"), disabled: true }]
  }, [tasks, projects, t])

  const projectFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProjectForm(t), {
        pricelistId: pricelistFieldOptions,
        partnerId: partnerFieldOptions,
      }),
    [t, pricelistFieldOptions, partnerFieldOptions],
  )

  const taskFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTaskForm(t), {
        projectId: projectFieldOptions,
        stageId: taskStageFieldOptions,
      }),
    [t, projectFieldOptions, taskStageFieldOptions],
  )

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
                { label: t("projects.dashboard.activeProjects"), value: String(activeProjects), icon: "FolderKanban" },
                { label: t("projects.dashboard.openTasks"), value: String(openTasks), icon: "CheckSquare" },
                { label: t("projects.dashboard.overdueTasks"), value: String(overdueTasks), icon: "AlertCircle" },
                { label: t("projects.dashboard.hoursLogged"), value: `${Math.round(totalHoursSpent)}h`, icon: "Clock" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_project: () => setQuickActionForm({ form: projectFormConfig, action: "createProject" }),
            create_task: () => setQuickActionForm({ form: taskFormConfig, action: "createTask" }),
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
              label: String(p.name ?? t("projects.dashboard.projectFallback", { number: i + 1 })),
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
            .filter((tk) => {
              if (tk.isClosed) return false
              const deadlineMs = Number(tk.dateDeadline ?? 0) / 1000
              return deadlineMs > nowMs && deadlineMs <= fourteenDaysMs
            })
            .sort((a, b) => Number(a.dateDeadline ?? 0) - Number(b.dateDeadline ?? 0))
            .slice(0, 5)
            .map((tk) => {
              const deadlineMs = Number(tk.dateDeadline ?? 0) / 1000
              const dueStr = new Date(deadlineMs).toLocaleDateString("en", { month: "short", day: "numeric" })
              const proj = projects.find((p) => p.id === tk.projectId)
              return {
                milestone: String(tk.name ?? ""),
                project: String(proj?.name ?? "—"),
                owner: "—",
                due: dueStr,
                status: String(tk.state ?? "Open"),
              }
            })
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows: upcomingTasks } }
        }
        return w
      }),
    }))
  }, [projects, tasks, timesheets, t, moduleConfig, projectFormConfig, taskFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "projects") return { ...tab, createForm: projectFormConfig }
          if (tab.id === "tasks") return { ...tab, createForm: taskFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, projectFormConfig, taskFormConfig],
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
      const p = toCreateProjectParams(formData, pricelists, companyId)
      if (p) createProject.mutate(projectsParamsToJson(p))
    } else if (action === "createTask") {
      const p = toCreateTaskParams(formData, companyId)
      if (p) createTask.mutate(projectsParamsToJson(p))
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
        config={quickActionForm?.form ?? projectFormConfig}
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
