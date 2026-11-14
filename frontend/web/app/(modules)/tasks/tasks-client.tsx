"use client"

import { usePageCompositionActionSlot } from "@lumiere/ui/pages/page-composition-host"
import { OperationalPageComposition } from "../../../components/operational-page-composition"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { apiFetch } from "@lumiere/query-hooks/http"
import { AskAboutRecordButton } from "../../../components/ask-about-record-button"
import { useTranslation } from "@lumiere/i18n"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { TaskSummary } from "./task-summary"
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
import { unwrapEntityValue } from "@lumiere/ui/lib/entity-row-values"
import { isoToDate, microsToDate, stdbTimestampToDate } from "@lumiere/erp-shared/timestamp-values"
import { Ban, CheckCheck, CircleCheck, ExternalLink, Pencil, Plus, RotateCcw, Users } from "lucide-react"
import { projectStatusTag, TASK_BOARD_STATES, taskBoardState, type TaskBoardState } from "../projects/project-record"
import { taskAttachmentCounts, taskBoardItemInState, toTaskBoardItem } from "./task-board-items"
import { TaskAssigneesDialog } from "./task-assignees-dialog"
import { matchesTaskRecord, taskRecordTarget, type TaskRecordLink } from "./task-record-link"

const TASK_COLUMN_COLORS = ["bg-info", "bg-warning", "bg-category-3", "bg-success", "bg-destructive"] as const

interface TasksClientProps {
  organizationId?: number
  initialTasks?: ProjectTask[]
  initialProjects?: ProjectProject[]
  taskLink?: TaskRecordLink
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
    case "wbsCode":
      return task.wbsCode ?? ""
    case "milestoneId":
      return String(unwrapEntityValue(task.milestoneId) ?? "")
    case "dateDeadline": {
      const raw = unwrapEntityValue(task.dateDeadline)
      const deadline = typeof raw === "number" || typeof raw === "bigint" || typeof raw === "string" && /^-?\d+$/.test(raw)
        ? microsToDate(raw)
        : typeof raw === "string" ? isoToDate(raw) : stdbTimestampToDate(raw)
      return deadline?.toISOString().split("T")[0] ?? ""
    }
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
  taskLink,
}: TasksClientProps & { organizationId: number }) {
  useProjectsModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const session = useErpSession()
  const [modal, setModal] = useState<ModalState>({ type: null })
  const [assignmentTaskId, setAssignmentTaskId] = useState<string | null>(null)
  const { permissionsReady, checkPermission, currentUser, roles, policies } = useRBAC()
  const canCreate = permissionsReady !== false && checkPermission("project_task", "create").allowed
  const linkedTaskId = taskRecordTarget(taskLink, operatingCompanyId)
  const linkScopeReady = permissionsReady === true && session.activeCompanyReady === true
    && session.organizationId === organizationId && currentUser?.id === session.identity
    && Boolean(session.identity) && session.identity !== "unknown"
  const canReadLinkedTask = linkScopeReady && linkedTaskId !== undefined && checkPermission("project_task", "read").allowed
  const linkScope = JSON.stringify([organizationId, String(operatingCompanyId), session.identity, currentUser, roles, policies, linkedTaskId])
  const currentLinkScope = useRef(linkScope)
  currentLinkScope.current = linkScope
  const linkedTaskQuery = useQuery({
    queryKey: ["project-task-record", linkScope],
    enabled: canReadLinkedTask,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const response = await apiFetch(`/api/authoritative/tasks/${linkedTaskId}?companyId=${operatingCompanyId}`, { cache: "no-store", signal })
      if (response.status === 403 || response.status === 404) return null
      if (!response.ok) throw new Error("Task read failed")
      const { data } = await response.json() as { data?: unknown }
      return linkedTaskId && matchesTaskRecord(data, linkedTaskId, orgId, operatingCompanyId) ? data as ProjectTask : null
    },
  })
  const linkedTask = canReadLinkedTask && linkedTaskQuery.isSuccess
    ? linkedTaskQuery.data
    : null
  const linkedTaskStatus = linkedTask ? projectStatusTag(linkedTask.state) : undefined
  const canEditLinkedTask = Boolean(linkedTask) && checkPermission("project_task", "write").allowed
  const tasksRead = moduleCollection(useTasks(orgId, initialTasks, { enabled: !taskLink }))
  const tasks = tasksRead.rows
  const canAssign = taskLink ? canEditLinkedTask : tasksRead.state.status === "ready" && permissionsReady !== false && checkPermission("project_task", "write").allowed
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
      (linkedTask ? [linkedTask] : tasks) as Record<string, unknown>[],
      projects as Record<string, unknown>[],
    )
    if (fromPairs.length > 0) return [optional, ...fromPairs]
    return [{ value: "", label: t("common.lookup.noTaskStages"), disabled: true }]
  }, [linkedTask, tasks, projects, t])

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
      const milestoneId = getTaskFieldValue(task, "milestoneId")
      return {
        ...base,
        sections: base.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => ({
            ...field,
            ...(field.name === "milestoneId" && milestoneId ? {
              options: [{ label: `#${milestoneId}`, value: String(milestoneId) }],
            } : {}),
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
        return pending ? taskBoardItemInState(item, pending) : item
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
    const task = taskLink ? linkedTask : tasks.find((row) => String(row.id) === taskId)
    if (!task || String(task.id) !== taskId) return
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
          { id: "assign", label: "Assign people", icon: Users, isApplicable: () => canAssign, onClick: (row) => setAssignmentTaskId(String(row.id)) },
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
      if (taskLink && (linkedTaskQuery.isFetching || String(linkedTask?.id) !== String(modal.entityId))) {
        throw new Error(t("tasks.link.unavailable", { defaultValue: "This task is unavailable in the current company." }))
      }
      const p = toUpdateTaskParams(formData)
      if (!p) throw new Error(t("tasks.errors.incomplete", { defaultValue: "Enter a task title and check the task details before saving. Your entries are retained." }))
      await updateTask.mutateAsync({
        taskId: modal.entityId,
        params: projectsParamsToJson(p),
      })
      if (taskLink && currentLinkScope.current === linkScope) await linkedTaskQuery.refetch()
    }
  }

  const isPending =
    createTask.isPending || updateTask.isPending || updateTaskState.isPending
  const assignmentTask = taskLink
    ? linkedTask?.id != null && String(linkedTask.id) === assignmentTaskId ? linkedTask : undefined
    : tasks.find((task) => String(task.id) === assignmentTaskId)
  const { target: compositionTarget, slot: compositionSlot } = usePageCompositionActionSlot()
  const editScope = taskLink ? linkScope : null
  useEffect(() => {
    setModal({ type: null })
    setAssignmentTaskId(null)
  }, [editScope])

  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col gap-4">
      <DashboardHeader
        title={t("tasks.page.title")}
        description={t("tasks.page.description")}
        primaryAction={!taskLink && canCreate ? <Button
          size="sm"
          onClick={() => setModal({ type: "create", form: taskFormConfig, action: "createTask" })}
        >
          <Plus aria-hidden="true" />
          {t("tasks.board.createTask")}
        </Button> : undefined}
        secondaryAction={<>
          <Link href="/projects?tab=tasks" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ExternalLink aria-hidden="true" />
            {t("tasks.board.viewProjects")}
          </Link>
          {compositionSlot}
        </>}
      />
      <OperationalPageComposition moduleId="tasks" title={t("tasks.page.title")} actionTarget={compositionTarget}>
        <div className="flex min-h-[calc(100dvh-12rem)] min-w-0 flex-col gap-4">

          {taskLink ? (
            <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t("tasks.link.title", { defaultValue: "Linked task" })}>
              {linkedTask ? (
                <>
                  <h2 className="break-words font-semibold">{linkedTask.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    #{String(linkedTask.id)}
                    {linkedTaskStatus ? ` · ${t(`tasks.board.columns.${linkedTaskStatus}`, { defaultValue: linkedTaskStatus })}` : null}
                  </p>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">{t("projects.forms.editTask.fields.dateDeadline")}</dt>
                      <dd>{String(getTaskFieldValue(linkedTask, "dateDeadline") || "—")}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("tasks.link.assignees", { defaultValue: "Assignees" })}</dt>
                      <dd className="break-words">{toTaskBoardItem(linkedTask, { projectNames, identityLabels, attachmentCounts }).assignees.map(({ name }) => name).join(", ") || "—"}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <AskAboutRecordButton entityType="project_task" recordId={String(linkedTask.id)} label={linkedTask.name} activeTab="tasks" />
                    {canEditLinkedTask ? (
                      <Button size="sm" variant={taskLink.view === "assign" ? "outline" : "default"} onClick={() => openEditTask(String(linkedTask.id))}>
                        {taskLink.view === "edit" ? t("tasks.link.review", { defaultValue: "Review task changes" }) : t("common.edit")}
                      </Button>
                    ) : null}
                    {canEditLinkedTask ? (
                      <Button size="sm" variant={taskLink.view === "assign" ? "default" : "outline"} onClick={() => setAssignmentTaskId(String(linkedTask.id))}>
                        {t("tasks.link.assign", { defaultValue: "Assign people" })}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : linkedTaskQuery.isFetching ? (
                <p role="status" className="text-sm">{t("tasks.link.loading", { defaultValue: "Loading task…" })}</p>
              ) : linkedTaskQuery.isError && canReadLinkedTask ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm">{t("tasks.link.error", { defaultValue: "The task could not be loaded." })}</p>
                  <Button size="sm" variant="outline" onClick={() => { void linkedTaskQuery.refetch() }}>{t("common.retry")}</Button>
                </div>
              ) : (
                <p role="status" className="text-sm">{t("tasks.link.unavailable", { defaultValue: "This task is unavailable in the current company." })}</p>
              )}
              <Link href="/tasks" className="inline-block text-sm text-primary underline-offset-4 hover:underline">{t("workspace.actions.openMyWork", { defaultValue: "Open my work" })}</Link>
            </section>
          ) : (
            <>
              <ModuleDataNotice state={tasksRead.state} />
              {tasksRead.state.status === "loading" ? <Skeleton className="h-96 w-full" /> : null}
              {(tasksRead.state.status === "ready" || tasksRead.state.status === "partial") && <TaskBoardView
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
              />}
            </>
          )}

          <FormModal
            open={modal.type === "create" ? canCreate : modal.type === "edit" && canAssign}
            onOpenChange={(open) => !open && setModal({ type: null })}
            config={modal.type ? modal.form : taskFormConfig}
            isPending={isPending || Boolean(taskLink && linkedTaskQuery.isFetching)}
            formLeadingActions={modal.type === "edit" && canAssign ? (
              <Button type="button" variant="outline" disabled={isPending} onClick={() => setAssignmentTaskId(String(modal.entityId))}>
                <Users className="mr-2 h-4 w-4" /> Assign people
              </Button>
            ) : undefined}
            onSubmit={async (formData) => {
              if (!modal.type) return
              if (modal.type === "create" ? !canCreate : !canAssign) throw new Error("Task permission is required")
              await handleFormSubmit(modal.action, formData)
              setModal({ type: null })
            }}
          />
          {assignmentTask && canAssign ? (
            <TaskAssigneesDialog key={`${organizationId}:${assignmentTask.companyId}:${assignmentTask.id}`} organizationId={orgId} task={assignmentTask} onClose={() => {
              setAssignmentTaskId(null)
              if (taskLink) void linkedTaskQuery.refetch()
            }} />
          ) : null}
          {taskLink ? null : <TaskSummary items={boardItems} state={tasksRead.state} />}
        </div>
      </OperationalPageComposition>
    </div>
  )
}
