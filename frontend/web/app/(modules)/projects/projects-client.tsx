"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState, useCallback, useEffect } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  newProjectForm,
  newTaskForm,
  editProjectForm,
  editTaskForm,
  logTimesheetForm,
  newProjectRateCardForm,
  newProjectRateCardLineForm,
  newResourceAllocationForm,
  newProjectMilestoneForm,
  projectExpenseRebillForm,
  newProjectChangeOrderForm,
  linkSubcontractorCostForm,
  newProjectIntegrationIntentForm,
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
  toStartTimesheetTimerParams,
} from "@/lib/projects-create-params"
import { projectsModuleConfig } from "@/lib/module-dashboard-configs"
import { useProjectsModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useProjects,
  useTasks,
  useTimesheets,
  useTimesheetsToValidate,
  useTimesheetsUnbilled,
  useProjectRateCards,
  useCreateProject,
  useCreateTask,
  useCreateTimesheet,
  useCreateProjectRateCard,
  useCreateProjectRateCardLine,
  useCreateResourceAllocation,
  useCreateProjectMilestone,
  useResourceAllocations,
  useResourceCapacityByEmployee,
  useProjectMarginByProject,
  useResourceUtilisationByEmployee,
  useProjectMilestones,
  useHrResources,
  useHrSkills,
  useHrEmployeeSkills,
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
  useCapacityForecastByEmployee,
  useProjectChangeOrders,
  useProjectEarnedValueByProject,
  useProjectIntegrationIntents,
  useCreateProjectChangeOrder,
  useLinkSubcontractorCost,
  useCreateProjectIntegrationIntent,
  useRefreshCapacityForecast,
  useRefreshProjectEarnedValue,
} from "@lumiere/query-hooks/hooks/projects"
import {
  useCreateExpenseProjectRebill,
  useExpenseSheets,
} from "@lumiere/query-hooks/hooks/expenses"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { useUoms } from "@lumiere/query-hooks/hooks/inventory"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useContacts, useUsers } from "@lumiere/query-hooks/hooks/crm"
import { useAccountAccounts, useAccountJournals } from "@lumiere/query-hooks/hooks/accounting"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import {
  pricelistRowsToSelectOptions,
  contactRowsToPartnerSelectOptions,
  projectRowsToSelectOptions,
  taskRowsToSelectOptions,
  taskStagePairOptionsFromTasks,
  userRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
  employeeRowsToSelectOptions,
  uomRowsToSelectOptions,
  currencyOptionsFromRows,
} from "@/lib/form-lookup"
import {
  ProjectGanttPanel,
  ResourceAllocationPanel,
  ResourceUtilisationPanel,
} from "./projects-panels"
import { AdvancedPsaPanel } from "./advanced-psa-panel"
import { TimesheetCapturePanel } from "./timesheet-capture-panel"
import {
  enqueueTimesheetCapture,
  getOrCreateTimesheetCaptureDeviceId,
  markTimesheetCaptureError,
  markTimesheetCaptureSynced,
  newTimesheetClientRequestId,
} from "@/lib/timesheet-capture-outbox"

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
  | { type: "expenseRebill"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "rateCardLine"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "resourceAllocation"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "projectMilestone"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "changeOrder"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "subcontractorCost"; rows: Record<string, unknown>[]; form: FormConfig }
  | { type: "integrationIntent"; rows: Record<string, unknown>[]; form: FormConfig }

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
          { id: "invoice-date", type: "date", name: "invoiceDate", label: "Invoice date", required: true, width: "1/2" },
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

  const { data: projects = [] } = useProjects(orgId, initialProjects)
  const { data: tasks = [] } = useTasks(orgId, initialTasks)
  const { data: timesheets = [] } = useTimesheets(orgId, initialTimesheets)
  const { data: timesheetsToValidate = [] } = useTimesheetsToValidate(orgId)
  const { data: timesheetsUnbilled = [] } = useTimesheetsUnbilled(orgId)
  const { data: rateCards = [] } = useProjectRateCards(orgId)
  const { data: allocations = [] } = useResourceAllocations(orgId)
  const { data: capacity = [] } = useResourceCapacityByEmployee(orgId)
  const { data: projectMargins = [] } = useProjectMarginByProject(orgId)
  const { data: utilisation = [] } = useResourceUtilisationByEmployee(orgId)
  const { data: milestones = [] } = useProjectMilestones(orgId)
  const { data: capacityForecast = [] } = useCapacityForecastByEmployee(orgId)
  const { data: changeOrders = [] } = useProjectChangeOrders(orgId)
  const { data: earnedValue = [] } = useProjectEarnedValueByProject(orgId)
  const { data: projectIntents = [] } = useProjectIntegrationIntents(orgId)
  const { data: hrResources = [] } = useHrResources(orgId)
  const { data: hrSkills = [] } = useHrSkills(orgId)
  const { data: hrEmployeeSkills = [] } = useHrEmployeeSkills(orgId)
  const { data: expenseSheets = [] } = useExpenseSheets(orgId)
  const { data: employees = [] } = useEmployees(orgId)
  const { data: uoms = [] } = useUoms(orgId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: contacts = [] } = useContacts(orgId, initialContacts)
  const { data: users = [] } = useUsers(orgId)
  const { data: accountJournals = [] } = useAccountJournals(orgId)
  const { data: accountAccounts = [] } = useAccountAccounts(orgId)
  const { data: currencies = [] } = useCurrencies()

  const createProject = useCreateProject(orgId, operatingCompanyId)
  const createTask = useCreateTask(orgId, operatingCompanyId)
  const createRateCard = useCreateProjectRateCard(orgId, operatingCompanyId)
  const createRateCardLine = useCreateProjectRateCardLine(orgId, operatingCompanyId)
  const createAllocation = useCreateResourceAllocation(orgId, operatingCompanyId)
  const createMilestone = useCreateProjectMilestone(orgId, operatingCompanyId)
  const createChangeOrder = useCreateProjectChangeOrder(orgId, operatingCompanyId)
  const linkSubcontractor = useLinkSubcontractorCost(orgId, operatingCompanyId)
  const createProjectIntent = useCreateProjectIntegrationIntent(orgId)
  const refreshForecast = useRefreshCapacityForecast(orgId, operatingCompanyId)
  const refreshEvm = useRefreshProjectEarnedValue(orgId, operatingCompanyId)
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
  const projectRebill = useCreateExpenseProjectRebill(orgId)
  const csvImports = useProjectsCsvImportMutations(orgId, operatingCompanyId)

  const moduleConfig = useMemo(() => projectsModuleConfig(t), [t])

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

  const employeeFieldOptions = useMemo(() => {
    const fromApi = employeeRowsToSelectOptions(employees as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noEmployees"), disabled: true }]
  }, [employees, t])

  const currencyFieldOptions = useMemo(
    () => currencyOptionsFromRows(currencies),
    [currencies],
  )

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noUoms"), disabled: true }]
  }, [uoms, t])

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

  const allocationFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newResourceAllocationForm(t), {
        employeeId: employeeFieldOptions,
        resourceId:
          (hrResources as Record<string, unknown>[]).length > 0
            ? (hrResources as Record<string, unknown>[]).map((r) => ({
                value: String(r.id),
                label: String(r.name ?? r.id),
              }))
            : [{ value: "", label: "No HR resources", disabled: true }],
        projectId: projectFieldOptions,
        taskId: taskFieldOptions,
      }),
    [employeeFieldOptions, hrResources, projectFieldOptions, taskFieldOptions, t],
  )

  const milestoneFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProjectMilestoneForm(t), {
        projectId: projectFieldOptions,
      }),
    [projectFieldOptions, t],
  )

  const changeOrderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProjectChangeOrderForm(t), {
        projectId: projectFieldOptions,
      }),
    [projectFieldOptions, t],
  )

  const subcontractorFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(linkSubcontractorCostForm(t), {
        projectId: projectFieldOptions,
      }),
    [projectFieldOptions, t],
  )

  const integrationIntentFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProjectIntegrationIntentForm(t), {
        projectId: projectFieldOptions,
      }),
    [projectFieldOptions, t],
  )

  const milestoneFieldOptions = useMemo(() => {
    const optional = { value: "", label: "—" }
    const fromApi = (milestones as Record<string, unknown>[]).map((m) => ({
      value: String(m.id),
      label: String(m.name ?? m.id),
    }))
    if (fromApi.length > 0) return [optional, ...fromApi]
    return [optional]
  }, [milestones])

  const resourceTab = useMemo(
    () => ({
      id: "resource-allocation",
      label: t("projects.resourceAllocation.title"),
      type: "custom" as const,
      customContent: (
        <ResourceAllocationPanel
          employees={employees as Record<string, unknown>[]}
          hrResources={hrResources as Record<string, unknown>[]}
          allocations={allocations as Record<string, unknown>[]}
          capacity={capacity as Record<string, unknown>[]}
          employeeSkills={hrEmployeeSkills as Record<string, unknown>[]}
          skills={hrSkills as Record<string, unknown>[]}
          onBookAllocation={() =>
            setLifecycleModal({
              type: "resourceAllocation",
              rows: [],
              form: allocationFormConfig,
            })
          }
        />
      ),
    }),
    [
      employees,
      hrResources,
      allocations,
      capacity,
      hrEmployeeSkills,
      hrSkills,
      allocationFormConfig,
      t,
    ],
  )

  const utilisationTab = useMemo(
    () => ({
      id: "utilisation",
      label: "Utilisation",
      type: "custom" as const,
      customContent: (
        <ResourceUtilisationPanel
          employees={employees as Record<string, unknown>[]}
          utilisation={utilisation as Record<string, unknown>[]}
        />
      ),
    }),
    [employees, utilisation],
  )

  const advancedTab = useMemo(
    () => ({
      id: "advanced-psa",
      label: "Advanced PSA",
      type: "custom" as const,
      customContent: (
        <div className="space-y-6">
          <AdvancedPsaPanel
            forecast={capacityForecast as Record<string, unknown>[]}
            changeOrders={changeOrders as Record<string, unknown>[]}
            earnedValue={earnedValue as Record<string, unknown>[]}
            intents={projectIntents as Record<string, unknown>[]}
            onNewChangeOrder={() =>
              setLifecycleModal({
                type: "changeOrder",
                rows: [],
                form: changeOrderFormConfig,
              })
            }
            onLinkSubcontractor={() =>
              setLifecycleModal({
                type: "subcontractorCost",
                rows: [],
                form: subcontractorFormConfig,
              })
            }
            onNewIntent={() =>
              setLifecycleModal({
                type: "integrationIntent",
                rows: [],
                form: integrationIntentFormConfig,
              })
            }
            onRefreshForecast={() =>
              void refreshForecast.mutateAsync({
                employeeId: null,
                periodStart: null,
                periodEnd: null,
                metadata: null,
              })
            }
            onRefreshEvm={() =>
              void refreshEvm.mutateAsync({
                projectIds: [],
                metadata: null,
              })
            }
          />
          <TimesheetCapturePanel organizationId={organizationId} />
        </div>
      ),
    }),
    [
      capacityForecast,
      changeOrders,
      earnedValue,
      projectIntents,
      changeOrderFormConfig,
      subcontractorFormConfig,
      integrationIntentFormConfig,
      refreshForecast,
      refreshEvm,
      organizationId,
    ],
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
        milestoneId: milestoneFieldOptions,
      }),
    [t, projectFieldOptions, taskStageFieldOptions, milestoneFieldOptions],
  )

  const timesheetFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(logTimesheetForm(t), {
        projectId: projectFieldOptions,
        taskId: taskFieldOptions,
        employeeId: employeeFieldOptions,
        currencyId: currencyFieldOptions,
        encodingUomId: uomFieldOptions,
      }),
    [t, projectFieldOptions, taskFieldOptions, employeeFieldOptions, currencyFieldOptions, uomFieldOptions],
  )

  const rateCardFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProjectRateCardForm(t), {
        currencyId: currencyFieldOptions,
        projectId: [{ value: "", label: "—" }, ...projectFieldOptions],
      }),
    [t, currencyFieldOptions, projectFieldOptions],
  )

  const rateCardSelectOptions = useMemo(() => {
    const opts = (rateCards as Record<string, unknown>[]).map((r) => ({
      value: String(r.id ?? ""),
      label: String(r.name ?? r.id ?? ""),
    }))
    if (opts.length > 0) return opts
    return [{ value: "", label: "No rate cards", disabled: true }]
  }, [rateCards])

  const rateCardLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProjectRateCardLineForm(t), {
        rateCardId: rateCardSelectOptions,
        currencyId: currencyFieldOptions,
        employeeId: employeeFieldOptions,
        taskId: taskFieldOptions,
      }),
    [t, rateCardSelectOptions, currencyFieldOptions, employeeFieldOptions, taskFieldOptions],
  )

  const postedSheetOptions = useMemo(() => {
    const opts = (expenseSheets as Record<string, unknown>[])
      .filter((s) => {
        const st = String(s.state ?? "")
        return (st === "Posted" || st === "Done") && s.rebillMoveId == null
      })
      .map((s) => ({
        value: String(s.id ?? ""),
        label: String(s.name ?? s.id ?? ""),
      }))
    if (opts.length > 0) return opts
    return [{ value: "", label: "No posted sheets to rebill", disabled: true }]
  }, [expenseSheets])

  const expenseRebillFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(projectExpenseRebillForm(t), {
        sheetId: postedSheetOptions,
        journalId: journalFieldOptions,
        receivableAccountId: incomeAccountFieldOptions,
        incomeAccountId: incomeAccountFieldOptions,
      }),
    [t, postedSheetOptions, journalFieldOptions, incomeAccountFieldOptions],
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
      milestoneId: milestoneFieldOptions,
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
  }, [t, projectFieldOptions, taskStageFieldOptions, milestoneFieldOptions])

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

  // Live KPI overrides from queue subscriptions + hours
  const liveSections = useMemo(() => {
    const activeProjects = projects.filter(
      (p) => p.active !== false && String(p.lastUpdateStatus) !== "Cancelled",
    ).length
    const totalHoursSpent = timesheets.reduce((s, ts) => s + Number(ts.unitAmount ?? 0), 0)
    const toValidateCount = timesheetsToValidate.length
    const unbilledHours = timesheetsUnbilled.reduce(
      (s, ts) => s + Number(ts.unitAmount ?? 0),
      0,
    )

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("projects.dashboard.activeProjects"), value: String(activeProjects), icon: "FolderKanban" },
                { label: "To validate", value: String(toValidateCount), icon: "CheckSquare", testId: "proj-queue-to-validate" },
                { label: "Unbilled hours", value: `${Math.round(unbilledHours * 10) / 10}h`, icon: "AlertCircle", testId: "proj-queue-unbilled" },
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
        if (w.id === "proj-budget-health") {
          const projectName = new Map(
            projects.map((p) => [String(p.id), String(p.name ?? p.id)]),
          )
          const values = (projectMargins as Record<string, unknown>[])
            .slice(0, 8)
            .map((m) => ({
              project: projectName.get(String(m.projectId ?? "")) ?? String(m.projectId ?? "—"),
              Budget: Math.round(Number(m.budgetPlanned ?? 0)),
              Spent: Math.round(Number(m.budgetActual ?? 0)),
              Margin: Math.round(Number(m.marginPercent ?? 0)),
              href: `/projects?tab=timesheets&projectId=${m.projectId ?? ""}`,
            }))
          return {
            ...w,
            title: "Budget vs actual / margin",
            data: {
              categoryKey: "project",
              series: [
                { name: "Budget", color: "#94a3b8" },
                { name: "Spent", color: "#6366f1" },
              ],
              values,
              testId: "proj-margin-panel",
            },
          }
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
          })
  }, [
    projects,
    tasks,
    timesheets,
    timesheetsToValidate,
    timesheetsUnbilled,
    projectMargins,
    t,
    moduleConfig,
    projectFormConfig,
    taskFormConfig,
    timesheetFormConfig,
  ])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    return projectsCsvImportForm(t, csvKind)
  }, [csvKind, t])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: [
          ...withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
          if (tab.id === "rate-cards" && tab.entityConfig) {
            return {
              ...tab,
              createForm: rateCardFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "add-rate-line",
                  label: "Add rate line",
                  onClick: () => {
                    setLifecycleError(null)
                    setLifecycleModal({
                      type: "rateCardLine",
                      rows: [],
                      form: rateCardLineFormConfig,
                    })
                  },
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
          utilisationTab,
          advancedTab,
        ],
      }) as ModuleConfig,
    [
      moduleConfig,
      ganttTab,
      resourceTab,
      utilisationTab,
      advancedTab,
      liveSections,
      projectFormConfig,
      taskFormConfig,
      timesheetFormConfig,
      rateCardFormConfig,
      rateCardLineFormConfig,
      expenseRebillFormConfig,
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
      "rate-cards": rateCards as unknown as Record<string, unknown>[],
      resources: employees as unknown as Record<string, unknown>[],
    }),
    [projects, tasks, timesheets, rateCards, employees],
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
      const p = toLogTimesheetParams(
        formData,
        operatingCompanyId,
        projects as Record<string, unknown>[],
      )
      if (p) {
        const deviceId = getOrCreateTimesheetCaptureDeviceId()
        const clientRequestId = newTimesheetClientRequestId()
        const payload = {
          projectId: String(formData.projectId ?? ""),
          taskId: String(formData.taskId ?? ""),
          employeeId: String(formData.employeeId ?? ""),
          date: String(formData.date ?? new Date().toISOString().slice(0, 10)),
          unitAmount: Number(formData.unitAmount ?? 0),
          name: formData.name != null ? String(formData.name) : undefined,
          description:
            formData.description != null ? String(formData.description) : undefined,
          timesheetInvoiceType:
            formData.timesheetInvoiceType != null
              ? String(formData.timesheetInvoiceType)
              : undefined,
          currencyId:
            formData.currencyId != null ? String(formData.currencyId) : undefined,
        }
        try {
          await createTimesheet.mutateAsync(projectsParamsToJson(p))
          markTimesheetCaptureSynced(organizationId, deviceId, clientRequestId)
        } catch (err) {
          enqueueTimesheetCapture(organizationId, {
            clientRequestId,
            deviceId,
            payload,
          })
          markTimesheetCaptureError(
            organizationId,
            deviceId,
            clientRequestId,
            err instanceof Error ? err.message : String(err),
          )
          throw err
        }
      }
    } else if (action === "startTimer") {
      const p = toStartTimesheetTimerParams(
        formData,
        operatingCompanyId,
        projects as Record<string, unknown>[],
      )
      if (p) await startTimer.mutateAsync(projectsParamsToJson(p))
    } else if (action === "createRateCard") {
      const projectRaw = formData.projectId
      await createRateCard.mutateAsync({
        name: String(formData.name ?? ""),
        currencyId: BigInt(String(formData.currencyId)),
        projectId:
          projectRaw != null && String(projectRaw).trim() !== ""
            ? BigInt(String(projectRaw))
            : null,
        active: formData.active !== false && formData.active !== "false",
        effectiveFrom: null,
        effectiveTo: null,
        metadata: null,
      })
    }
  }

  const isFormMutationPending =
    createProject.isPending ||
    createTask.isPending ||
    createRateCard.isPending ||
    createRateCardLine.isPending ||
    createAllocation.isPending ||
    createMilestone.isPending ||
    createChangeOrder.isPending ||
    linkSubcontractor.isPending ||
    createProjectIntent.isPending ||
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
    projectRebill.isPending ||
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
                if (operatingCompanyId == null) throw new Error("Select an active company")
                if (formData.invoiceDate == null || String(formData.invoiceDate).trim() === "") {
                  throw new Error("Invoice date is required")
                }
                await billTimesheets.mutateAsync({
                  companyId: operatingCompanyId,
                  timesheetIds: ids,
                  journalId: formData.journalId as string | number,
                  incomeAccountId: formData.incomeAccountId as string | number,
                  partnerId: formData.partnerId as string | number,
                  invoiceDate: formData.invoiceDate as string | number | Date,
                })
              } else if (lifecycleModal.type === "expenseRebill") {
                // Surface expenses reducer create_expense_project_rebill (do not reimplement).
                const sheetId = formData.sheetId
                const journalId = formData.journalId
                const receivableAccountId = formData.receivableAccountId
                const incomeAccountId = formData.incomeAccountId
                const d = formData.invoiceDate
                if (
                  sheetId == null ||
                  sheetId === "" ||
                  !journalId ||
                  !receivableAccountId ||
                  !incomeAccountId ||
                  d == null ||
                  d === ""
                ) {
                  throw new Error("Sheet, journal, accounts, and invoice date are required")
                }
                await projectRebill.mutateAsync({
                  sheetId: String(sheetId),
                  params: {
                    invoiceDate: stbTimestampFromDate(new Date(String(d))),
                    journalId: BigInt(String(journalId)),
                    receivableAccountId: BigInt(String(receivableAccountId)),
                    incomeAccountId: BigInt(String(incomeAccountId)),
                  },
                })
              } else if (lifecycleModal.type === "rateCardLine") {
                const empRaw = formData.employeeId
                const taskRaw = formData.taskId
                await createRateCardLine.mutateAsync({
                  rateCardId: BigInt(String(formData.rateCardId)),
                  scope: String(formData.scope ?? "employee"),
                  employeeId:
                    empRaw != null && String(empRaw).trim() !== ""
                      ? BigInt(String(empRaw))
                      : null,
                  taskId:
                    taskRaw != null && String(taskRaw).trim() !== ""
                      ? BigInt(String(taskRaw))
                      : null,
                  currencyId: BigInt(String(formData.currencyId)),
                  costRate: Number(formData.costRate ?? 0),
                  sellRate: Number(formData.sellRate ?? 0),
                  active: formData.active !== false && formData.active !== "false",
                  effectiveFrom: null,
                  effectiveTo: null,
                  metadata: null,
                })
              } else if (lifecycleModal.type === "resourceAllocation") {
                const empRaw = formData.employeeId
                const resRaw = formData.resourceId
                const taskRaw = formData.taskId
                const from = formData.dateFrom
                const to = formData.dateTo
                if (!formData.projectId || from == null || from === "" || to == null || to === "") {
                  throw new Error("Project, date from, and date to are required")
                }
                const skillHint =
                  formData.skillHint != null && String(formData.skillHint).trim() !== ""
                    ? String(formData.skillHint)
                    : null
                await createAllocation.mutateAsync({
                  employeeId:
                    empRaw != null && String(empRaw).trim() !== ""
                      ? BigInt(String(empRaw))
                      : null,
                  resourceId:
                    resRaw != null && String(resRaw).trim() !== ""
                      ? BigInt(String(resRaw))
                      : null,
                  projectId: BigInt(String(formData.projectId)),
                  taskId:
                    taskRaw != null && String(taskRaw).trim() !== ""
                      ? BigInt(String(taskRaw))
                      : null,
                  dateFrom: stbTimestampFromDate(new Date(String(from))),
                  dateTo: stbTimestampFromDate(new Date(String(to))),
                  allocatedHours: Number(formData.allocatedHours ?? 0),
                  allocationPercent: Number(formData.allocationPercent ?? 0),
                  name: null,
                  notes:
                    formData.notes != null && String(formData.notes).trim() !== ""
                      ? String(formData.notes)
                      : null,
                  enforceCapacity:
                    formData.enforceCapacity !== false && formData.enforceCapacity !== "false",
                  active: true,
                  metadata: skillHint ? JSON.stringify({ skillHint }) : null,
                })
              } else if (lifecycleModal.type === "projectMilestone") {
                const d = formData.deadline
                await createMilestone.mutateAsync({
                  projectId: BigInt(String(formData.projectId)),
                  name: String(formData.name ?? "").trim(),
                  description:
                    formData.description != null && String(formData.description).trim() !== ""
                      ? String(formData.description)
                      : null,
                  deadline:
                    d != null && String(d).trim() !== ""
                      ? stbTimestampFromDate(new Date(String(d)))
                      : null,
                  sequence: Number(formData.sequence ?? 10),
                  isReached: false,
                  billAmount: Number(formData.billAmount ?? 0),
                  percentComplete: Number(formData.percentComplete ?? 0),
                  active: true,
                  metadata: null,
                })
              } else if (lifecycleModal.type === "changeOrder") {
                await createChangeOrder.mutateAsync({
                  projectId: BigInt(String(formData.projectId)),
                  name: String(formData.name ?? "").trim(),
                  description:
                    formData.description != null && String(formData.description).trim() !== ""
                      ? String(formData.description)
                      : null,
                  scopeDelta:
                    formData.scopeDelta != null && String(formData.scopeDelta).trim() !== ""
                      ? String(formData.scopeDelta)
                      : null,
                  budgetDelta: Number(formData.budgetDelta ?? 0),
                  plannedHoursDelta: Number(formData.plannedHoursDelta ?? 0),
                  rateDeltaPercent: Number(formData.rateDeltaPercent ?? 0),
                  metadata: null,
                })
              } else if (lifecycleModal.type === "subcontractorCost") {
                const poRaw = formData.purchaseOrderId
                const poLineRaw = formData.purchaseOrderLineId
                await linkSubcontractor.mutateAsync({
                  projectId: BigInt(String(formData.projectId)),
                  purchaseOrderId:
                    poRaw != null && String(poRaw).trim() !== ""
                      ? BigInt(String(poRaw))
                      : null,
                  purchaseOrderLineId:
                    poLineRaw != null && String(poLineRaw).trim() !== ""
                      ? BigInt(String(poLineRaw))
                      : null,
                  vendorBillMoveId: null,
                  vendorBillLineId: null,
                  partnerId: null,
                  amount: Number(formData.amount ?? 0),
                  currencyId: BigInt(String(formData.currencyId)),
                  name:
                    formData.name != null && String(formData.name).trim() !== ""
                      ? String(formData.name)
                      : null,
                  active: true,
                  metadata: null,
                })
              } else if (lifecycleModal.type === "integrationIntent") {
                const projRaw = formData.projectId
                await createProjectIntent.mutateAsync({
                  companyId: operatingCompanyId,
                  projectId:
                    projRaw != null && String(projRaw).trim() !== ""
                      ? BigInt(String(projRaw))
                      : null,
                  intentType: String(formData.intentType ?? "payroll_export"),
                  idempotencyKey: String(formData.idempotencyKey ?? "").trim(),
                  payload: String(formData.payload ?? "{}"),
                  metadata: null,
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
        <CsvImportModal
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === "project") await csvImports.importProject.mutateAsync(text)
            else await csvImports.importTimesheet.mutateAsync(text)
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
    case 'billType':
      return String(project.billType ?? 'customer_task')
    case 'pricingType':
      return String(project.pricingType ?? 'task_rate')
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
