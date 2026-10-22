"use client"

import { useMemo, useState } from "react"
import { isWorkspaceSurfaceVisible, type WorkspaceProfile } from "@lumiere/ui/lib/workspace-profile"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import {
  MiniCalendarWidget,
  ProjectProgressWidget,
  RecentNotesWidget,
  TodayTasksWidget,
  customDashboardWidget,
  type DashboardSection,
  type QuickActionsWidget,
} from "@lumiere/ui"
import { useIdentityLabelMap } from "@lumiere/ui/hooks/use-identity-label-map"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { useCalendarEvents } from "@lumiere/query-hooks/hooks/calendar"
import { useKnowledgeArticles } from "@lumiere/query-hooks/hooks/documents"
import {
  useUpdateTaskState,
  type ProjectProject,
  type ProjectTask,
} from "@lumiere/query-hooks/hooks/projects"
import { agendaItems, myWorkTasks, projectProgress, recentNotes } from "./productivity-data"

export interface ProductivitySectionsOptions {
  organizationId: bigint
  tasks: readonly ProjectTask[]
  projects: readonly ProjectProject[]
  /** Leads the sections with the quick-actions widget when given. */
  quickActions?: QuickActionsWidget["data"]["actions"]
  /** Section ids are prefixed with this, so two dashboards never share one. */
  idPrefix: string
  /** Only global Overview discovery uses the workspace profile; linked Project workflows stay intact. */
  workspaceProfile?: WorkspaceProfile
}

/**
 * "My work" dashboard sections from live rows: the signed-in person's tasks (ticking one marks it
 * done through `update_task_state`), a mini calendar of events and deadlines, project progress
 * and recent knowledge notes.
 */
export function useProductivitySections({
  organizationId,
  tasks,
  projects,
  quickActions,
  idPrefix,
  workspaceProfile = "full",
}: ProductivitySectionsOptions): DashboardSection[] {
  const { t } = useTranslation()
  const { identity } = useErpSession()
  const identityLabels = useIdentityLabelMap(organizationId)
  const { data: events = [] } = useCalendarEvents(organizationId)
  const { data: articles = [] } = useKnowledgeArticles(organizationId)
  const updateTaskState = useUpdateTaskState(organizationId)
  // Ticked tasks stay listed (struck through) until the page is left.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())

  return useMemo(() => {
    const projectNames = new Map(projects.map((project) => [String(project.id), project.name]))
    const now = Date.now()
    const toggleDone = async (taskId: string, done: boolean) => {
      try {
        await updateTaskState.mutateAsync({ taskId, state: done ? "Done" : "InProgress" })
        setTicked((prev) => new Set(prev).add(taskId))
      } catch (error) {
        showWorkflowToast({
          kind: "error",
          title: t("tasks.board.moveFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const showProjects = isWorkspaceSurfaceVisible(workspaceProfile, "projects")
    const sections: DashboardSection[] = []
    if (quickActions && quickActions.length > 0) {
      sections.push({
        id: `${idPrefix}-quick-actions`,
        title: t("workspace.myWork"),
        widgets: [
          {
            id: `${idPrefix}-quick-actions-widget`,
            type: "quick-actions",
            title: t("workspace.widgets.quickActions"),
            width: "full",
            data: { columns: 4, actions: quickActions },
          },
        ],
      })
    }
    sections.push(
      {
        id: `${idPrefix}-today`,
        title: quickActions ? undefined : t("workspace.myWork"),
        widgets: [
          customDashboardWidget({
            id: `${idPrefix}-today-tasks`,
            title: t("workspace.widgets.todayTasks"),
            width: "2/3",
            component: TodayTasksWidget,
            data: {
              tasks: myWorkTasks(tasks, {
                identity,
                projectNames,
                priorityLabel: (priority) => t(`projects.tasks.priority.${priority}`, { defaultValue: priority }),
                now,
                keep: ticked,
              }).map((task) => showProjects ? task : { ...task, href: "/tasks" }),
              onToggleDone: toggleDone,
              viewAllHref: "/tasks",
            },
          }),
          customDashboardWidget({
            id: `${idPrefix}-calendar`,
            title: t("workspace.widgets.calendar"),
            width: "1/3",
            component: MiniCalendarWidget,
            data: { items: agendaItems(events, tasks).map((item) => !showProjects && item.kind === "deadline" ? { ...item, href: "/tasks" } : item), calendarHref: "/calendar" },
          }),
        ],
      },
      {
        id: `${idPrefix}-projects`,
        title: showProjects ? t("workspace.sections.projects") : undefined,
        widgets: [
          ...(showProjects ? [customDashboardWidget({
            id: `${idPrefix}-project-progress`,
            title: t("workspace.widgets.projects"),
            width: "2/3",
            component: ProjectProgressWidget,
            data: { projects: projectProgress(projects, tasks, identityLabels) },
          })] : []),
          customDashboardWidget({
            id: `${idPrefix}-recent-notes`,
            title: t("workspace.widgets.notes"),
            width: showProjects ? "1/3" : "full",
            component: RecentNotesWidget,
            data: { notes: recentNotes(articles) },
          }),
        ],
      },
    )
    return sections
    // updateTaskState is a stable mutation object; its identity changes with its status.
  }, [t, identity, identityLabels, events, articles, tasks, projects, quickActions, idPrefix, ticked, workspaceProfile]) // eslint-disable-line react-hooks/exhaustive-deps
}
