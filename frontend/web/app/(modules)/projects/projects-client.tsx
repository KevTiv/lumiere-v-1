"use client"

import { useMemo, useState, useCallback, useEffect } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newProjectForm,
  newTaskForm,
  editProjectForm,
  editTaskForm,
  logTimesheetForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  projectsCsvImportForm,
} from "@lumiere/ui"
import type { EntityViewConfig, FormConfig, ModuleConfig, ProjectsCsvImportKind } from "@lumiere/ui"
import {
  projectsParamsToJson,
  toCreateProjectParams,
  toCreateTaskParams,
  toUpdateProjectParams,
  toUpdateTaskParams,
  toLogTimesheetParams,
} from "@/lib/projects-create-params"
import { projectsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useProjects,
  useTasks,
  useTimesheets,
  useCreateProject,
  useCreateTask,
  useCreateTimesheet,
  useUpdateProject,
  useUpdateTask,
  useUpdateTaskState,
  useStartTimesheetTimer,
  useStopTimesheetTimer,
  useSetProjectActive,
  useToggleProjectFavorite,
  useSetTaskParent,
  useAssignTaskUsers,
  useValidateTimesheets,
  useBillTimesheets,
  useEmployees,
  useProjectsCsvImportMutations,
} from "@lumiere/query-hooks/hooks/projects"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useContacts, useUsers } from "@lumiere/query-hooks/hooks/crm"
import {
  pricelistRowsToSelectOptions,
  contactRowsToPartnerSelectOptions,
  projectRowsToSelectOptions,
  taskRowsToSelectOptions,
  taskStagePairOptionsFromTasks,
  employeeRowsToSelectOptions,
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

type ModalState =
  | { type: null }
  | { type: 'create'; form: FormConfig; action: string }
  | { type: 'edit'; form: FormConfig; action: string; entityId: string | number }
  | { type: 'timesheet'; form: FormConfig; action: string }

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
  const [modal, setModal] = useState<ModalState>({ type: null })
  const [csvKind, setCsvKind] = useState<ProjectsCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  const { data: projects = [] } = useProjects(orgId, initialProjects)
  const { data: tasks = [] } = useTasks(orgId, initialTasks)
  const { data: timesheets = [] } = useTimesheets(orgId, initialTimesheets)
  const { data: employees = [] } = useEmployees(orgId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: contacts = [] } = useContacts(orgId, initialContacts)
  const { data: users = [] } = useUsers(orgId)

  const createProject = useCreateProject(orgId, companyId)
  const createTask = useCreateTask(orgId, companyId)
  const updateProject = useUpdateProject(orgId, companyId)
  const updateTask = useUpdateTask(orgId, companyId)
  const updateTaskState = useUpdateTaskState(orgId)
  const createTimesheet = useCreateTimesheet(orgId, companyId)
  const startTimer = useStartTimesheetTimer(orgId, companyId)
  const stopTimer = useStopTimesheetTimer(orgId)
  const setProjectActive = useSetProjectActive(orgId)
  const toggleFavorite = useToggleProjectFavorite(orgId)
  const setTaskParent = useSetTaskParent(orgId)
  const assignTaskUsers = useAssignTaskUsers(orgId)
  const validateTimesheets = useValidateTimesheets(orgId)
  const billTimesheets = useBillTimesheets(orgId)
  const csvImports = useProjectsCsvImportMutations(orgId, companyId)

  const moduleConfig = useMemo(() => projectsModuleConfig(t), [t])

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: Array<{ id: string; label: string; onClick: () => void }>,
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        rowSelectionToggleOnClick: false,
        actions,
      },
    }
  }

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

  const taskFieldOptions = useMemo(() => {
    const fromApi = taskRowsToSelectOptions(tasks)
    const optional = { value: "", label: "—" }
    if (fromApi.length > 0) return [optional, ...fromApi]
    return [{ value: "", label: t("common.lookup.noTasks"), disabled: true }]
  }, [tasks, t])

  const employeeFieldOptions = useMemo(() => {
    const fromApi = employeeRowsToSelectOptions(employees)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noEmployees"), disabled: true }]
  }, [employees, t])

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

  const timesheetFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(logTimesheetForm(t), {
        projectId: projectFieldOptions,
        taskId: taskFieldOptions,
      }),
    [t, projectFieldOptions, taskFieldOptions],
  )

  // Helper to build edit form with initial values
  const buildEditProjectForm = useCallback((project: Record<string, unknown>): FormConfig => {
    const base = mergeSelectOptionsForFields(editProjectForm(t), {
      pricelistId: pricelistFieldOptions,
      partnerId: partnerFieldOptions,
    })
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          const updatedField = { ...field, defaultValue: getProjectFieldValue(project, field.name) }
          return updatedField as typeof field
        }),
      })) as typeof base.sections,
    }
  }, [t, pricelistFieldOptions, partnerFieldOptions])

  const buildEditTaskForm = useCallback((task: Record<string, unknown>): FormConfig => {
    const base = mergeSelectOptionsForFields(editTaskForm(t), {
      projectId: projectFieldOptions,
      stageId: taskStageFieldOptions,
    })
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          const updatedField = { ...field, defaultValue: getTaskFieldValue(task, field.name) }
          return updatedField as typeof field
        }),
      })) as typeof base.sections,
    }
  }, [t, projectFieldOptions, taskStageFieldOptions])

  // Handle row click for edit
  const handleRowClick = useCallback((tabId: string, row: Record<string, unknown>) => {
    if (tabId === 'projects') {
      setModal({
        type: 'edit',
        form: buildEditProjectForm(row),
        action: "updateProject",
        entityId: row.id as string | number,
      })
    } else if (tabId === 'tasks') {
      setModal({
        type: 'edit',
        form: buildEditTaskForm(row),
        action: "updateTask",
        entityId: row.id as string | number,
      })
    }
  }, [buildEditProjectForm, buildEditTaskForm])

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
            create_project: () => setModal({ type: 'create', form: projectFormConfig, action: "createProject" }),
            create_task: () => setModal({ type: 'create', form: taskFormConfig, action: "createTask" }),
            log_timesheet: () => setModal({ type: 'timesheet', form: timesheetFormConfig, action: "logTimesheet" }),
            start_timer: () => setModal({ type: 'timesheet', form: timesheetFormConfig, action: "startTimer" }),
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
  }, [projects, tasks, timesheets, t, moduleConfig, projectFormConfig, taskFormConfig, timesheetFormConfig])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    return projectsCsvImportForm(t, csvKind)
  }, [csvKind, t])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "projects" && tab.entityConfig) {
            return {
              ...tab,
              createForm: projectFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-project",
                  label: t("projects.toolbar.importProjectCsv"),
                  onClick: () => setCsvKind("project"),
                },
              ]),
            }
          }
          if (tab.id === "tasks" && tab.entityConfig) {
            return {
              ...tab,
              createForm: taskFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-task",
                  label: t("projects.toolbar.importTaskCsv"),
                  onClick: () => setCsvKind("task"),
                },
              ]),
            }
          }
          if (tab.id === "timesheets" && tab.entityConfig) {
            return {
              ...tab,
              createForm: timesheetFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-timesheet",
                  label: t("projects.toolbar.importTimesheetCsv"),
                  onClick: () => setCsvKind("timesheet"),
                },
              ]),
            }
          }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, projectFormConfig, taskFormConfig, timesheetFormConfig, t],
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
    } else if (action === "updateProject" && modal.type === 'edit') {
      const p = toUpdateProjectParams(formData)
      if (p) updateProject.mutate({ projectId: modal.entityId, params: projectsParamsToJson(p) })
    } else if (action === "updateTask" && modal.type === 'edit') {
      const p = toUpdateTaskParams(formData)
      if (p) updateTask.mutate({ taskId: modal.entityId, params: projectsParamsToJson(p) })
    } else if (action === "logTimesheet") {
      const p = toLogTimesheetParams(formData, companyId)
      if (p) createTimesheet.mutate(projectsParamsToJson(p))
    } else if (action === "startTimer") {
      const p = toLogTimesheetParams(formData, companyId)
      if (p) startTimer.mutate(projectsParamsToJson(p))
    }
  }

  const handleModalSubmit = (formData: Record<string, unknown>) => {
    if (!modal.type || modal.type === null) return

    const tabId = modal.type === 'create' ? 'dashboard' : modal.type === 'edit' ? (modal.action === 'updateProject' ? 'projects' : 'tasks') : 'timesheets'
    handleFormSubmit(tabId, modal.action, formData)
    setModal({ type: null })
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleRowClick}
      />
      <FormModal
        open={modal.type !== null}
        onOpenChange={(open) => !open && setModal({ type: null })}
        config={modal.type ? modal.form : projectFormConfig}
        onSubmit={handleModalSubmit}
      />
      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "project") await csvImports.importProject.mutateAsync(text)
              else if (csvKind === "task") await csvImports.importTask.mutateAsync(text)
              else await csvImports.importTimesheet.mutateAsync(text)
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </>
  )
}

// Helper functions to extract field values from entities
function getProjectFieldValue(project: Record<string, unknown>, fieldName: string): unknown {
  switch (fieldName) {
    case 'name':
      return project.name ?? ''
    case 'pricelistId':
      return String(project.pricelistId ?? '')
    case 'partnerId':
      return String(project.partnerId ?? '')
    case 'allocatedHours':
      return project.allocatedHours ?? ''
    case 'dateStart':
      return project.dateStart ? new Date(Number(project.dateStart) / 1000).toISOString().split('T')[0] : ''
    case 'dateEnd':
      return project.dateEnd ? new Date(Number(project.dateEnd) / 1000).toISOString().split('T')[0] : ''
    case 'description':
      return project.description ?? ''
    case 'active':
      return project.active ?? true
    default:
      return ''
  }
}

function getTaskFieldValue(task: Record<string, unknown>, fieldName: string): unknown {
  switch (fieldName) {
    case 'name':
      return task.name ?? ''
    case 'projectId':
      return String(task.projectId ?? '')
    case 'stageId':
      return task.stageId ? `${task.projectId}:${task.stageId}` : ''
    case 'priority':
      return String(task.priority ?? '0')
    case 'plannedHours':
      return task.plannedHours ?? ''
    case 'dateDeadline':
      return task.dateDeadline ? new Date(Number(task.dateDeadline) / 1000).toISOString().split('T')[0] : ''
    case 'description':
      return task.description ?? ''
    case 'kanbanState':
      return task.kanbanState ?? 'normal'
    default:
      return ''
  }
}
