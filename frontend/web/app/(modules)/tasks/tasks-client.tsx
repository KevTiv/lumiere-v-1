"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import {
  DashboardHeader,
  FormModal,
  MissingOrganization,
  mergeSelectOptionsForFields,
  newTaskForm,
  editTaskForm,
} from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { enumTag } from "@/lib/accounting-post-draft"
import { useProjectsModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  projectsParamsToJson,
  toCreateTaskParams,
  toUpdateTaskParams,
} from "@/lib/projects-create-params"
import {
  projectRowsToSelectOptions,
  taskStagePairOptionsFromTasks,
} from "@/lib/form-lookup"
import {
  useTasks,
  useProjects,
  useCreateTask,
  useUpdateTask,
  useUpdateTaskState,
} from "@lumiere/query-hooks/hooks/projects"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { Button, buttonVariants } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Badge } from "@lumiere/ui/components/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { cn } from "@lumiere/ui/lib/utils"
import { Plus, Search, ExternalLink } from "lucide-react"

const TASK_COLUMNS = [
  "InProgress",
  "ChangesRequested",
  "Approved",
  "Done",
  "Cancelled",
] as const

type TaskColumnId = (typeof TASK_COLUMNS)[number]

interface TasksClientProps {
  organizationId?: number
  initialTasks?: Record<string, unknown>[]
  initialProjects?: Record<string, unknown>[]
}

type ModalState =
  | { type: null }
  | { type: "create"; form: FormConfig; action: string }
  | { type: "edit"; form: FormConfig; action: string; entityId: string | number }

function taskStateTag(task: Record<string, unknown>): TaskColumnId {
  const tag = enumTag(task.state) as TaskColumnId
  if (TASK_COLUMNS.includes(tag)) return tag
  if (task.isClosed) return "Done"
  return "InProgress"
}

function priorityLabel(priority: unknown, t: (key: string) => string): string {
  const key = String(priority ?? "0")
  return t(`projects.tasks.priority.${key}`)
}

function formatDeadline(raw: unknown): string | null {
  if (raw == null) return null
  const ms = Number(raw) / 1000
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function getTaskFieldValue(task: Record<string, unknown>, fieldName: string): unknown {
  switch (fieldName) {
    case "name":
      return task.name ?? ""
    case "projectId":
      return String(task.projectId ?? "")
    case "stageId":
      return task.stageId ? `${task.projectId}:${task.stageId}` : ""
    case "priority":
      return String(task.priority ?? "0")
    case "plannedHours":
      return task.plannedHours ?? ""
    case "dateDeadline":
      return task.dateDeadline
        ? new Date(Number(task.dateDeadline) / 1000).toISOString().split("T")[0]
        : ""
    case "description":
      return task.description ?? ""
    case "kanbanState":
      return task.kanbanState ?? "normal"
    default:
      return ""
  }
}

export function TasksClient(props: TasksClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <TasksClientLoaded {...props} organizationId={props.organizationId} />
}

function TasksClientLoaded({
  organizationId,
  initialTasks,
  initialProjects,
}: TasksClientProps & { organizationId: number }) {
  useProjectsModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [modal, setModal] = useState<ModalState>({ type: null })
  const [searchQuery, setSearchQuery] = useState("")
  const [projectFilter, setProjectFilter] = useState<string>("all")

  const { data: tasks = [] } = useTasks(orgId, initialTasks)
  const { data: projects = [] } = useProjects(orgId, initialProjects)
  const createTask = useCreateTask(orgId, operatingCompanyId)
  const updateTask = useUpdateTask(orgId, operatingCompanyId)
  const updateTaskState = useUpdateTaskState(orgId)

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

  const taskFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTaskForm(t), {
        projectId: projectFieldOptions,
        stageId: taskStageFieldOptions,
      }),
    [t, projectFieldOptions, taskStageFieldOptions],
  )

  const buildEditTaskForm = useCallback(
    (task: Record<string, unknown>): FormConfig => {
      const base = mergeSelectOptionsForFields(editTaskForm(t), {
        projectId: projectFieldOptions,
        stageId: taskStageFieldOptions,
      })
      return {
        ...base,
        sections: base.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => ({
            ...field,
            defaultValue: getTaskFieldValue(task, field.name),
          })) as typeof section.fields,
        })) as typeof base.sections,
      }
    },
    [t, projectFieldOptions, taskStageFieldOptions],
  )

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return (tasks as Record<string, unknown>[]).filter((task) => {
      const matchesProject =
        projectFilter === "all" || String(task.projectId ?? "") === projectFilter
      if (!matchesProject) return false
      if (!q) return true
      const project = projects.find((p) => p.id === task.projectId)
      return (
        String(task.name ?? "").toLowerCase().includes(q) ||
        String(project?.name ?? "").toLowerCase().includes(q)
      )
    })
  }, [tasks, projects, searchQuery, projectFilter])

  const tasksByColumn = useMemo(() => {
    const grouped = Object.fromEntries(
      TASK_COLUMNS.map((col) => [col, [] as Record<string, unknown>[]]),
    ) as Record<TaskColumnId, Record<string, unknown>[]>
    for (const task of filteredTasks) {
      grouped[taskStateTag(task)].push(task)
    }
    return grouped
  }, [filteredTasks])

  const stats = useMemo(() => {
    const all = tasks as Record<string, unknown>[]
    const nowMs = Date.now()
    return {
      total: all.length,
      inProgress: all.filter((task) => taskStateTag(task) === "InProgress").length,
      done: all.filter((task) => taskStateTag(task) === "Done").length,
      overdue: all.filter((task) => {
        if (task.isClosed || task.dateDeadline == null) return false
        return Number(task.dateDeadline) / 1000 < nowMs
      }).length,
    }
  }, [tasks])

  const handleMoveTask = async (taskId: string | number | bigint, column: TaskColumnId) => {
    await updateTaskState.mutateAsync({
      taskId,
      state: { tag: column },
    })
  }

  const handleFormSubmit = async (action: string, formData: Record<string, unknown>) => {
    if (action === "createTask") {
      const p = toCreateTaskParams(formData, operatingCompanyId)
      if (p) await createTask.mutateAsync(projectsParamsToJson(p))
    } else if (action === "updateTask" && modal.type === "edit") {
      const p = toUpdateTaskParams(formData)
      if (p) {
        await updateTask.mutateAsync({
          taskId: modal.entityId,
          params: projectsParamsToJson(p),
        })
      }
    }
  }

  const isPending =
    createTask.isPending || updateTask.isPending || updateTaskState.isPending

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <DashboardHeader title={t("tasks.page.title")} description={t("tasks.page.description")} />
        <div className="flex items-center gap-2">
          <Link
            href="/projects?tab=tasks"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("tasks.board.viewProjects")}
          </Link>
          <Button
            size="sm"
            onClick={() => setModal({ type: "create", form: taskFormConfig, action: "createTask" })}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("tasks.board.createTask")}
          </Button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: t("tasks.board.stats.total"), value: stats.total },
          { label: t("tasks.board.stats.inProgress"), value: stats.inProgress },
          { label: t("tasks.board.stats.done"), value: stats.done },
          { label: t("tasks.board.stats.overdue"), value: stats.overdue },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-2xl font-semibold">{item.value}</p>
            <p className="text-xs text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("tasks.board.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("tasks.board.allProjects")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tasks.board.allProjects")}</SelectItem>
            {projectFieldOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={"disabled" in option ? option.disabled : false}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full gap-4 pb-4">
          {TASK_COLUMNS.map((columnId) => {
            const columnTasks = tasksByColumn[columnId]
            return (
              <div
                key={columnId}
                className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/20"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h3 className="text-sm font-medium">
                    {t(`tasks.board.columns.${columnId}`)}
                  </h3>
                  <Badge variant="secondary">{columnTasks.length}</Badge>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {columnTasks.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {t("tasks.board.emptyColumn")}
                    </p>
                  ) : (
                    columnTasks.map((task) => {
                      const project = projects.find((p) => p.id === task.projectId)
                      const deadline = formatDeadline(task.dateDeadline)
                      const overdue =
                        task.dateDeadline != null &&
                        !task.isClosed &&
                        Number(task.dateDeadline) / 1000 < Date.now()
                      return (
                        <div
                          key={String(task.id)}
                          className="rounded-md border border-border bg-background p-3 shadow-sm"
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() =>
                              setModal({
                                type: "edit",
                                form: buildEditTaskForm(task),
                                action: "updateTask",
                                entityId: task.id as string | number,
                              })
                            }
                          >
                            <p className="text-sm font-medium leading-snug">{String(task.name ?? "")}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {String(project?.name ?? "—")}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {priorityLabel(task.priority, t)}
                              </Badge>
                              {deadline ? (
                                <span
                                  className={cn(
                                    "text-[10px]",
                                    overdue ? "text-destructive" : "text-muted-foreground",
                                  )}
                                >
                                  {deadline}
                                </span>
                              ) : null}
                            </div>
                          </button>
                          <Select
                            value={columnId}
                            onValueChange={(value) =>
                              void handleMoveTask(task.id as string | number, value as TaskColumnId)
                            }
                          >
                            <SelectTrigger className="mt-2 h-8 text-xs">
                              <SelectValue placeholder={t("tasks.board.changeState")} />
                            </SelectTrigger>
                            <SelectContent>
                              {TASK_COLUMNS.map((state) => (
                                <SelectItem key={state} value={state}>
                                  {t(`tasks.board.columns.${state}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <FormModal
        open={modal.type !== null}
        onOpenChange={(open) => !open && setModal({ type: null })}
        config={modal.type ? modal.form : taskFormConfig}
        isPending={isPending}
        onSubmit={async (formData) => {
          if (!modal.type) return
          await handleFormSubmit(modal.action, formData)
          setModal({ type: null })
        }}
      />
    </div>
  )
}
