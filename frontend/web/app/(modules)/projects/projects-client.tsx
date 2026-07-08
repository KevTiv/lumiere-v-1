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
  ImportAssistantWizard,
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
import { useProjectsModuleSubscription } from "@/lib/module-subscription-hooks"
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
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useContacts, useUsers } from "@lumiere/query-hooks/hooks/crm"
import { useAccountAccounts, useAccountJournals } from "@lumiere/query-hooks/hooks/accounting"
import {
  pricelistRowsToSelectOptions,
  contactRowsToPartnerSelectOptions,
  projectRowsToSelectOptions,
  taskRowsToSelectOptions,
  taskStagePairOptionsFromTasks,
  userRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
} from "@/lib/form-lookup"
import { ProjectGanttPanel, ResourceAllocationPanel } from "./projects-panels"

export { PROJECTS_UI_REDUCERS } from "@/lib/projects-ui-reducers"

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

type LifecycleModalState =
  | { type: null }
  | { type: "taskState"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "taskParent"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "assignUsers"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "billTimesheets"; rows: Record<string, unknown>[]; form: FormConfig }

type ProjectToolbarAction = {
  id: string
  label: string
  requiresSelection?: boolean
  variant?: "default" | "destructive"
  onClick: (rows: Record<string, unknown>[]) => void
}

const taskStateForm: FormConfig = {
  id: "projects-update-task-state",
  title: "Update Task State",
  submitLabel: "Update state",
  sections: [
    {
      id: "state",
      fields: [
        {
          id: "state",
          type: "select",
          name: "state",
          label: "State",
          required: true,
          width: "full",
          options: [
            { value: "normal", label: "Normal" },
            { value: "blocked", label: "Blocked" },
            { value: "done", label: "Done" },
            { value: "cancelled", label: "Cancelled" },
          ],
        },
      ],
    },
  ],
}

const assignUsersForm = (userOptions: Array<{ value: string; label: string }>): FormConfig => ({
  id: "projects-assign-task-users",
  title: "Assign Task Users",
  submitLabel: "Assign users",
  description:
    userOptions.length > 0
      ? `Available users: ${userOptions.map((o) => `${o.label} (${o.value})`).slice(0, 5).join(", ")}${userOptions.length > 5 ? "…" : ""}`
      : undefined,
  sections: [
    {
      id: "users",
      fields: [
        {
          id: "user-ids",
          type: "textarea",
          name: "userIds",
          label: "User IDs, one per line",
          required: true,
          rows: 4,
          width: "full",
        },
      ],
    },
  ],
})

function buildBillTimesheetsForm(
  journalOptions: Array<{ value: string; label: string; disabled?: boolean }>,
  accountOptions: Array<{ value: string; label: string; disabled?: boolean }>,
  partnerOptions: Array<{ value: string; label: string; disabled?: boolean }>,
): FormConfig {
  return {
    id: "projects-bill-timesheets",
    title: "Bill Timesheets",
    submitLabel: "Bill timesheets",
    sections: [
      {
        id: "billing",
        fields: [
          { id: "journal", type: "select", name: "journalId", label: "Journal", required: true, width: "1/3", options: journalOptions },
          { id: "income-account", type: "select", name: "incomeAccountId", label: "Income account", required: true, width: "1/3", options: accountOptions },
          { id: "partner", type: "select", name: "partnerId", label: "Partner", required: true, width: "1/3", options: partnerOptions },
          { id: "invoice-date", type: "date", name: "invoiceDate", label: "Invoice date", width: "1/2" },
        ],
      },
    ],
  }
}

function taskParentForm(taskOptions: Array<{ value: string; label: string; disabled?: boolean }>): FormConfig {
  return {
    id: "projects-set-task-parent",
    title: "Set Task Parent",
    submitLabel: "Set parent",
    sections: [
      {
        id: "parent",
        fields: [
          {
            id: "parent-id",
            type: "select",
            name: "parentId",
            label: "Parent task",
            width: "full",
            options: taskOptions,
          },
        ],
      },
    ],
  }
}

function selectedIds(rows: Record<string, unknown>[]): Array<string | number | bigint> {
  return rows
    .map((row) => row.id as string | number | bigint | undefined)
    .filter((id): id is string | number | bigint => id != null && String(id).trim() !== "")
}

function idLines(value: unknown): Array<string | number | bigint> {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
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
  useProjectsModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [modal, setModal] = useState<ModalState>({ type: null })
  const [lifecycleModal, setLifecycleModal] = useState<LifecycleModalState>({ type: null })
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [csvKind, setCsvKind] = useState<ProjectsCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  const { data: projects = [] } = useProjects(orgId, initialProjects)
  const { data: tasks = [] } = useTasks(orgId, initialTasks)
  const { data: timesheets = [] } = useTimesheets(orgId, initialTimesheets)
  const { data: employees = [] } = useEmployees(orgId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: contacts = [] } = useContacts(orgId, initialContacts)
  const { data: users = [] } = useUsers(orgId)
  const { data: accountJournals = [] } = useAccountJournals(orgId)
  const { data: accountAccounts = [] } = useAccountAccounts(orgId)

  const createProject = useCreateProject(orgId, operatingCompanyId)
  const createTask = useCreateTask(orgId, operatingCompanyId)
  const updateProject = useUpdateProject(orgId, operatingCompanyId)
  const updateTask = useUpdateTask(orgId, operatingCompanyId)
  const updateTaskState = useUpdateTaskState(orgId)
  const createTimesheet = useCreateTimesheet(orgId, operatingCompanyId)
  const startTimer = useStartTimesheetTimer(orgId, operatingCompanyId)
  const stopTimer = useStopTimesheetTimer(orgId)
  const setProjectActive = useSetProjectActive(orgId)
  const toggleFavorite = useToggleProjectFavorite(orgId)
  const setTaskParent = useSetTaskParent(orgId)
  const assignTaskUsers = useAssignTaskUsers(orgId)
  const validateTimesheets = useValidateTimesheets(orgId)
  const billTimesheets = useBillTimesheets(orgId)
  const csvImports = useProjectsCsvImportMutations(orgId, operatingCompanyId)

  const moduleConfig = useMemo(() => projectsModuleConfig(t), [t])

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: ProjectToolbarAction[],
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

  const journalFieldOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(accountJournals as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [accountJournals, t])

  const incomeAccountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(accountAccounts as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [accountAccounts, t])

  const billTimesheetsFormConfig = useMemo(
    () => buildBillTimesheetsForm(journalFieldOptions, incomeAccountFieldOptions, partnerFieldOptions),
    [journalFieldOptions, incomeAccountFieldOptions, partnerFieldOptions],
  )

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

  const userFieldOptions = useMemo(() => {
    const fromApi = userRowsToSelectOptions(users as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: "No users available", disabled: true }]
  }, [users, t])

  const assignUsersFormConfig = useMemo(
    () => assignUsersForm(userFieldOptions),
    [userFieldOptions],
  )

  const ganttTab = useMemo(
    () => ({
      id: "gantt",
      label: t("projects.gantt.title"),
      type: "custom" as const,
      customContent: (
        <ProjectGanttPanel
          projects={projects as Record<string, unknown>[]}
          tasks={tasks as Record<string, unknown>[]}
        />
      ),
    }),
    [projects, tasks, t],
  )

  const resourceTab = useMemo(
    () => ({
      id: "resource-allocation",
      label: t("projects.resourceAllocation.title"),
      type: "custom" as const,
      customContent: (
        <ResourceAllocationPanel
          employees={employees as Record<string, unknown>[]}
          timesheets={timesheets as Record<string, unknown>[]}
        />
      ),
    }),
    [employees, timesheets, t],
  )

  const taskStageFieldOptions = useMemo(() => {
    const optional = { value: "", label: "—" }
    const fromPairs = taskStagePairOptionsFromTasks(
      tasks as Record<string, unknown>[],
      projects as Record<string, unknown>[],
    )
    if (fromPairs.length > 0) return [optional, ...fromPairs]
    return [{ value: "", label: t("common.lookup.noTaskStages"), disabled: true }]
  }, [tasks, projects, t])

  const taskParentFormConfig = useMemo(
    () => taskParentForm(taskFieldOptions),
    [taskFieldOptions],
  )

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

  const runForSelectedIds = useCallback(
    async (
      rows: Record<string, unknown>[],
      action: (id: string | number | bigint) => Promise<unknown>,
    ) => {
      const ids = selectedIds(rows)
      await Promise.all(ids.map((id) => action(id)))
    },
    [],
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
        tabs: [
          ...moduleConfig.tabs.map((tab) => {
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
                {
                  id: "toggle-favorite",
                  label: "Toggle favorite",
                  requiresSelection: true,
                  onClick: (rows) => void runForSelectedIds(rows, (id) => toggleFavorite.mutateAsync(id)),
                },
                {
                  id: "activate-project",
                  label: "Activate",
                  requiresSelection: true,
                  onClick: (rows) =>
                    void runForSelectedIds(rows, (id) =>
                      setProjectActive.mutateAsync({ projectId: id, active: true }),
                    ),
                },
                {
                  id: "archive-project",
                  label: "Archive",
                  requiresSelection: true,
                  onClick: (rows) =>
                    void runForSelectedIds(rows, (id) =>
                      setProjectActive.mutateAsync({ projectId: id, active: false }),
                    ),
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
                {
                  id: "task-state",
                  label: "Update state",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setLifecycleError(null)
                    setLifecycleModal({ type: "taskState", rows, form: taskStateForm })
                  },
                },
                {
                  id: "task-parent",
                  label: "Set parent",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setLifecycleError(null)
                    setLifecycleModal({ type: "taskParent", rows, form: taskParentFormConfig })
                  },
                },
                {
                  id: "assign-users",
                  label: "Assign users",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setLifecycleError(null)
                    setLifecycleModal({ type: "assignUsers", rows, form: assignUsersFormConfig })
                  },
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
                {
                  id: "stop-timer",
                  label: "Stop timer",
                  requiresSelection: true,
                  onClick: (rows) => void runForSelectedIds(rows, (id) => stopTimer.mutateAsync(id)),
                },
                {
                  id: "validate-timesheets",
                  label: "Validate",
                  requiresSelection: true,
                  onClick: (rows) =>
                    void validateTimesheets.mutateAsync({
                      companyId: operatingCompanyId,
                      timesheetIds: selectedIds(rows),
                    }),
                },
                {
                  id: "bill-timesheets",
                  label: "Bill",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setLifecycleError(null)
                    setLifecycleModal({ type: "billTimesheets", rows, form: billTimesheetsFormConfig })
                  },
                },
              ]),
            }
          }
          return tab
        }),
          ganttTab,
          resourceTab,
        ],
      }) as ModuleConfig,
    [
      moduleConfig,
      ganttTab,
      resourceTab,
      liveSections,
      projectFormConfig,
      taskFormConfig,
      timesheetFormConfig,
      t,
      runForSelectedIds,
      toggleFavorite,
      setProjectActive,
      taskParentFormConfig,
      assignUsersFormConfig,
      billTimesheetsFormConfig,
      stopTimer,
      validateTimesheets,
      operatingCompanyId,
    ],
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

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createProject") {
      const p = toCreateProjectParams(formData, pricelists, operatingCompanyId)
      if (p) await createProject.mutateAsync(projectsParamsToJson(p))
    } else if (action === "createTask") {
      const p = toCreateTaskParams(formData, operatingCompanyId)
      if (p) await createTask.mutateAsync(projectsParamsToJson(p))
    } else if (action === "updateProject" && modal.type === 'edit') {
      const p = toUpdateProjectParams(formData)
      if (p) await updateProject.mutateAsync({ projectId: modal.entityId, params: projectsParamsToJson(p) })
    } else if (action === "updateTask" && modal.type === 'edit') {
      const p = toUpdateTaskParams(formData)
      if (p) await updateTask.mutateAsync({ taskId: modal.entityId, params: projectsParamsToJson(p) })
    } else if (action === "logTimesheet") {
      const p = toLogTimesheetParams(formData, operatingCompanyId)
      if (p) await createTimesheet.mutateAsync(projectsParamsToJson(p))
    } else if (action === "startTimer") {
      const p = toLogTimesheetParams(formData, operatingCompanyId)
      if (p) await startTimer.mutateAsync(projectsParamsToJson(p))
    }
  }

  const isFormMutationPending =
    createProject.isPending ||
    createTask.isPending ||
    updateProject.isPending ||
    updateTask.isPending ||
    updateTaskState.isPending ||
    createTimesheet.isPending ||
    startTimer.isPending ||
    stopTimer.isPending ||
    setProjectActive.isPending ||
    toggleFavorite.isPending ||
    setTaskParent.isPending ||
    assignTaskUsers.isPending ||
    validateTimesheets.isPending ||
    billTimesheets.isPending ||
    csvImports.importProject.isPending ||
    csvImports.importTask.isPending ||
    csvImports.importTimesheet.isPending

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleRowClick}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={modal.type !== null}
        onOpenChange={(open) => !open && setModal({ type: null })}
        config={modal.type ? modal.form : projectFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (!modal.type) return
          const tabId =
            modal.type === 'create'
              ? 'dashboard'
              : modal.type === 'edit'
                ? modal.action === 'updateProject'
                  ? 'projects'
                  : 'tasks'
                : 'timesheets'
          await handleFormSubmit(tabId, modal.action, formData)
          setModal({ type: null })
        }}
      />
      {lifecycleModal.type !== null ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setLifecycleModal({ type: null })
              setLifecycleError(null)
            }
          }}
          config={lifecycleModal.form}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={lifecycleError}
          onSubmit={async (formData) => {
            setLifecycleError(null)
            try {
              const ids = selectedIds(lifecycleModal.rows)
              if (lifecycleModal.type === "taskState") {
                await Promise.all(
                  ids.map((taskId) =>
                    updateTaskState.mutateAsync({
                      taskId,
                      state: formData.state,
                    }),
                  ),
                )
              } else if (lifecycleModal.type === "taskParent") {
                const parentRaw = formData.parentId
                const parentId =
                  parentRaw != null && String(parentRaw).trim() !== ""
                    ? (parentRaw as string | number | bigint)
                    : null
                await Promise.all(
                  ids.map((taskId) =>
                    setTaskParent.mutateAsync({
                      taskId,
                      parentId,
                    }),
                  ),
                )
              } else if (lifecycleModal.type === "assignUsers") {
                const userIds = idLines(formData.userIds)
                if (userIds.length === 0) throw new Error("At least one user ID is required")
                await Promise.all(
                  ids.map((taskId) =>
                    assignTaskUsers.mutateAsync({
                      taskId,
                      userIds,
                    }),
                  ),
                )
              } else if (lifecycleModal.type === "billTimesheets") {
                if (ids.length === 0) throw new Error("Select at least one timesheet")
                await billTimesheets.mutateAsync({
                  companyId: operatingCompanyId,
                  timesheetIds: ids,
                  journalId: formData.journalId as string | number,
                  incomeAccountId: formData.incomeAccountId as string | number,
                  partnerId: formData.partnerId as string | number,
                  invoiceDate:
                    formData.invoiceDate != null && String(formData.invoiceDate).trim() !== ""
                      ? (formData.invoiceDate as string | number | Date)
                      : null,
                })
              }
              setLifecycleModal({ type: null })
            } catch (e) {
              setLifecycleError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      {csvKind === "task" ? (
        <ImportAssistantWizard
          key="task-assistant"
          open
          organizationId={organizationId}
          onOpenChange={(open) => !open && setCsvKind(null)}
          targetEntity="project_task"
          title={t("projects.csvImport.taskTitle")}
          isImportPending={csvImports.importTask.isPending}
          onImport={async (csvData) => {
            await csvImports.importTask.mutateAsync(csvData)
          }}
        />
      ) : null}
      {csvKind && csvKind !== "task" && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
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
