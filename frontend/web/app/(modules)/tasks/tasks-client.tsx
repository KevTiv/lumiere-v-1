"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import {
  DashboardHeader,
  EntityView,
  FormModal,
  MissingOrganization,
  TaskBoardView,
  mergeSelectOptionsForFields,
  newTaskForm,
  editTaskForm,
  tasksTableConfig,
} from "@lumiere/ui"
import type { EntityRow, EntityViewConfig, FormConfig } from "@lumiere/ui"
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
  type ProjectTask,
  type ProjectProject,
} from "@lumiere/query-hooks/hooks/projects"
import { useDocuments } from "@lumiere/query-hooks/hooks/documents"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { Button, buttonVariants } from "@lumiere/ui/components/button"
import { useIdentityLabelMap } from "@lumiere/ui/hooks/use-identity-label-map"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Ban, CheckCheck, CircleCheck, ExternalLink, Pencil, Plus, RotateCcw, Users } from "lucide-react"
import { TASK_BOARD_STATES, taskBoardState, type TaskBoardState } from "../projects/project-record"
import { taskAttachmentCounts, toTaskBoardItem } from "./task-board-items"
import { TaskAssigneesDialog } from "./task-assignees-dialog"

const TASK_COLUMN_COLORS = ["bg-info", "bg-warning", "bg-category-3", "bg-success", "bg-destructive"] as const

interface TasksClientProps {
  organizationId?: number
  initialTasks?: ProjectTask[]
  initialProjects?: ProjectProject[]
}

type ModalState =
  | { type: null }
  | { type: "create"; form: FormConfig; action: string }
  | { type: "edit"; form: FormConfig; action: string; entityId: string | number }

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
  const [assignmentTaskId, setAssignmentTaskId] = useState<string | null>(null)
  const { permissionsReady, checkPermission } = useRBAC()
  const canAssign = permissionsReady !== false && checkPermission("project_task", "write").allowed
  const canCreate = permissionsReady !== false && checkPermission("project_task", "create").allowed

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

  const identityLabels = useIdentityLabelMap(orgId)
  const { data: documents = [] } = useDocuments(orgId)
  const attachmentCounts = useMemo(() => taskAttachmentCounts(documents), [documents])
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [String(project.id), project.name])),
    [projects],
  )

  // A dropped card stays in its new column until the live rows agree or the move fails.
  const [pendingMoves, setPendingMoves] = useState<ReadonlyMap<string, TaskBoardState>>(new Map())

  const boardItems = useMemo(
    () =>
      tasks.map((task) => {
        const item = toTaskBoardItem(task, { projectNames, identityLabels, attachmentCounts })
        const pending = pendingMoves.get(item.id)
        return pending ? { ...item, columnId: pending } : item
      }),
    [tasks, projectNames, identityLabels, attachmentCounts, pendingMoves],
  )

  useEffect(() => {
    if (pendingMoves.size === 0) return
    const settled = tasks.filter((task) => pendingMoves.get(String(task.id)) === taskBoardState(task))
    if (settled.length === 0) return
    setPendingMoves((prev) => {
      const next = new Map(prev)
      for (const task of settled) next.delete(String(task.id))
      return next
    })
  }, [tasks, pendingMoves])

  const boardColumns = useMemo(
    () =>
      TASK_BOARD_STATES.map((state, index) => ({
        id: state,
        title: t(`tasks.board.columns.${state}`),
        colorClass: TASK_COLUMN_COLORS[index],
      })),
    [t],
  )

  const stats = useMemo(() => {
    const nowMs = Date.now()
    return {
      total: boardItems.length,
      inProgress: boardItems.filter((item) => item.columnId === "InProgress").length,
      done: boardItems.filter((item) => item.columnId === "Done").length,
      overdue: boardItems.filter((item) => !item.isClosed && item.dueAt != null && item.dueAt < nowMs).length,
    }
  }, [boardItems])

  const handleMoveTask = async (taskId: string, toColumnId: string) => {
    if (!canAssign) return
    const state = TASK_BOARD_STATES.find((candidate) => candidate === toColumnId)
    if (!state) return
    setPendingMoves((prev) => new Map(prev).set(taskId, state))
    try {
      await updateTaskState.mutateAsync({ taskId, state })
    } catch (error) {
      setPendingMoves((prev) => {
        const next = new Map(prev)
        next.delete(taskId)
        return next
      })
      showWorkflowToast({
        kind: "error",
        title: t("tasks.board.moveFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const openEditTask = (taskId: string) => {
    if (!canAssign) return
    const task = tasks.find((row) => String(row.id) === taskId)
    if (!task) return
    setModal({
      type: "edit",
      form: buildEditTaskForm(task),
      action: "updateTask",
      entityId: taskId,
    })
  }

  const tableConfig = useMemo((): EntityViewConfig => {
    const base = tasksTableConfig(t)
    if (base.view.mode !== "table") return base
    const moveTo = (state: TaskBoardState) => (row: EntityRow) => handleMoveTask(String(row.id), state)
    const notIn = (state: TaskBoardState) => (row: EntityRow) => canAssign && taskBoardState(row) !== state
    return {
      ...base,
      title: "",
      description: undefined,
      view: {
        ...base.view,
        listViewKey: "lumiere:tasks-table",
        columns: base.view.columns.map((column) =>
          column.key === "projectId"
            ? { ...column, render: (value: unknown) => projectNames.get(String(value ?? "")) ?? "—" }
            : column,
        ),
        rowActions: [
          { id: "edit", label: t("common.edit"), icon: Pencil, isApplicable: () => canAssign, onClick: (row) => openEditTask(String(row.id)) },
          { id: "assign", label: t("tasks.tasksClient.assignPeople"), icon: Users, isApplicable: () => canAssign, onClick: (row) => setAssignmentTaskId(String(row.id)) },
          { id: "approve", label: t("tasks.board.columns.Approved"), icon: CheckCheck, isApplicable: notIn("Approved"), onClick: moveTo("Approved") },
          { id: "done", label: t("tasks.board.columns.Done"), icon: CircleCheck, isApplicable: notIn("Done"), onClick: moveTo("Done") },
          { id: "reopen", label: t("tasks.board.columns.InProgress"), icon: RotateCcw, isApplicable: notIn("InProgress"), onClick: moveTo("InProgress") },
          { id: "cancel", label: t("tasks.board.columns.Cancelled"), icon: Ban, destructive: true, isApplicable: notIn("Cancelled"), onClick: moveTo("Cancelled") },
        ],
      },
    }
    // handleMoveTask/openEditTask read the latest rows through state setters and lookups.
  }, [t, projectNames, tasks, canAssign]) // eslint-disable-line react-hooks/exhaustive-deps
  const projectOptions = useMemo(
    () => projectFieldOptions.filter((option) => option.value !== "" && !("disabled" in option && option.disabled)),
    [projectFieldOptions],
  )

  const handleFormSubmit = async (action: string, formData: Record<string, unknown>) => {
    if (action === "createTask") {
      const p = toCreateTaskParams(formData, operatingCompanyId)
      if (!p) throw new Error(t("tasks.errors.incomplete", { defaultValue: "Enter a task title and check the task details before saving. Your entries are retained." }))
      await createTask.mutateAsync(projectsParamsToJson(p))
    } else if (action === "updateTask" && modal.type === "edit") {
      const p = toUpdateTaskParams(formData)
      if (!p) throw new Error(t("tasks.errors.incomplete", { defaultValue: "Enter a task title and check the task details before saving. Your entries are retained." }))
      await updateTask.mutateAsync({
        taskId: modal.entityId,
        params: projectsParamsToJson(p),
      })
    }
  }

  const isPending =
    createTask.isPending || updateTask.isPending || updateTaskState.isPending
  const assignmentTask = tasks.find((task) => String(task.id) === assignmentTaskId)

  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col gap-4">
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
          {canCreate ? <Button
            size="sm"
            onClick={() => setModal({ type: "create", form: taskFormConfig, action: "createTask" })}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("tasks.board.createTask")}
          </Button> : null}
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

      <TaskBoardView
        className="min-h-0 flex-1"
        items={boardItems}
        columns={boardColumns}
        onMove={canAssign ? handleMoveTask : undefined}
        onTaskClick={canAssign ? openEditTask : undefined}
        onCreateInColumn={canCreate ? () => setModal({ type: "create", form: taskFormConfig, action: "createTask" }) : undefined}
        priorityLabel={(priority) => t(`projects.tasks.priority.${priority}`, { defaultValue: priority })}
        projects={projectOptions}
        storageKey="lumiere:tasks-board-view"
        renderTable={(visibleIds) => (
          <EntityView
            config={tableConfig}
            useCard={false}
            data={tasks.filter((task) => visibleIds.has(String(task.id)))}
            onRowClick={canAssign ? (row) => openEditTask(String(row.id)) : undefined}
          />
        )}
      />

      <FormModal
        open={modal.type === "create" ? canCreate : modal.type === "edit" && canAssign}
        onOpenChange={(open) => !open && setModal({ type: null })}
        config={modal.type ? modal.form : taskFormConfig}
        isPending={isPending}
        formLeadingActions={modal.type === "edit" && canAssign ? (
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setAssignmentTaskId(String(modal.entityId))}>
            <Users className="mr-2 h-4 w-4" /> {" "}{t("tasks.tasksClient.assignPeople")}{" "}</Button>
        ) : undefined}
        onSubmit={async (formData) => {
          if (!modal.type) return
          if (modal.type === "create" ? !canCreate : !canAssign) throw new Error(t("tasks.tasksClient.taskPermissionIsRequired"))
          await handleFormSubmit(modal.action, formData)
          setModal({ type: null })
        }}
      />
      {assignmentTask && canAssign ? (
        <TaskAssigneesDialog key={`${organizationId}:${assignmentTask.companyId}:${assignmentTask.id}`} organizationId={orgId} task={assignmentTask} onClose={() => setAssignmentTaskId(null)} />
      ) : null}
    </div>
  )
}
