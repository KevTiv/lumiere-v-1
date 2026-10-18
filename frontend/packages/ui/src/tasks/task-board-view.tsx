"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ChevronDown, LayoutGrid, List, Search, Table2, Users } from "lucide-react"
import { Input } from "../components/input"
import { Badge } from "../components/badge"
import { Button } from "../components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select"
import { cn } from "../lib/utils"
import type { KanbanColumnDef } from "../lib/kanban-board-types"
import { KanbanBoard } from "../kanban/kanban-board"
import {
  AvatarStack,
  KanbanCardContent,
  type KanbanCardPerson,
  type KanbanCardTone,
} from "../kanban/kanban-card"

/** A task as the board shows it; callers map their rows into this shape. */
export interface TaskBoardItem {
  id: string
  title: string
  /** Board column (the task's state). */
  columnId: string
  projectId?: string
  projectName?: string
  /** Backend priority code: "0" normal, "1" low, "2" high, "3" urgent. */
  priority: string
  assignees: KanbanCardPerson[]
  /** Deadline in epoch milliseconds. */
  dueAt: number | null
  isClosed: boolean
  commentCount: number
  attachmentCount: number
  /** 0–100. */
  progress: number | null
}

export type TaskBoardViewMode = "board" | "list" | "table"

const VIEW_MODES: readonly TaskBoardViewMode[] = ["board", "list", "table"]
const ALL = "__all__"
const UNASSIGNED = "__unassigned__"

export const TASK_PRIORITY_TONES: Readonly<Partial<Record<string, KanbanCardTone>>> = {
  "0": "info",
  "1": "neutral",
  "2": "warning",
  "3": "destructive",
}

export interface TaskBoardViewProps {
  items: TaskBoardItem[]
  columns: KanbanColumnDef[]
  onMove: (taskId: string, toColumnId: string) => void | Promise<void>
  onTaskClick?: (taskId: string) => void
  /** Column "+" buttons; omitted hides them. */
  onCreateInColumn?: (columnId: string) => void
  priorityLabel: (priority: string) => string
  /** Options of the project filter; omitted hides it. */
  projects?: ReadonlyArray<{ value: string; label: string }>
  /** Table mode content for the tasks that pass the toolbar filters. Omitted hides the mode. */
  renderTable?: (visibleTaskIds: ReadonlySet<string>) => ReactNode
  /** Remembers the chosen mode under this key. */
  storageKey?: string
  className?: string
}

function isOverdue(item: TaskBoardItem, now: number): boolean {
  return !item.isClosed && item.dueAt != null && item.dueAt < now
}

function readStoredMode(key: string | undefined, allowed: readonly TaskBoardViewMode[]): TaskBoardViewMode | null {
  if (!key) return null
  try {
    const stored = window.localStorage.getItem(key)
    return allowed.find((mode) => mode === stored) ?? null
  } catch {
    return null
  }
}

export function TaskBoardView({
  items,
  columns,
  onMove,
  onTaskClick,
  onCreateInColumn,
  priorityLabel,
  projects,
  renderTable,
  storageKey,
  className,
}: TaskBoardViewProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const modes = renderTable ? VIEW_MODES : VIEW_MODES.filter((mode) => mode !== "table")
  const [viewMode, setViewMode] = useState<TaskBoardViewMode>("board")
  const [search, setSearch] = useState("")
  const [projectFilter, setProjectFilter] = useState(ALL)
  const [assigneeFilter, setAssigneeFilter] = useState(ALL)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // Restored after mount so server and client markup agree.
  useEffect(() => {
    const stored = readStoredMode(storageKey, modes)
    if (stored) setViewMode(stored)
  }, [storageKey, renderTable !== undefined]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeMode = (mode: TaskBoardViewMode) => {
    setViewMode(mode)
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, mode)
    } catch {
      /* not remembered */
    }
  }

  const people = useMemo(() => {
    const byId = new Map<string, KanbanCardPerson>()
    for (const item of items) for (const person of item.assignees) byId.set(person.id, person)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (projectFilter !== ALL && item.projectId !== projectFilter) return false
      if (assigneeFilter === UNASSIGNED && item.assignees.length > 0) return false
      if (
        assigneeFilter !== ALL &&
        assigneeFilter !== UNASSIGNED &&
        !item.assignees.some((person) => person.id === assigneeFilter)
      ) {
        return false
      }
      if (!q) return true
      return (
        item.title.toLowerCase().includes(q) || (item.projectName ?? "").toLowerCase().includes(q)
      )
    })
  }, [items, search, projectFilter, assigneeFilter])

  const visibleIds = useMemo(() => new Set(visible.map((item) => item.id)), [visible])
  const now = Date.now()

  const formatDue = (ms: number | null) =>
    ms == null ? undefined : new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" })

  const cardLabels = {
    comments: (count: number) => t("tasks.card.comments", { count }),
    attachments: (count: number) => t("tasks.card.attachments", { count }),
    progress: t("tasks.card.progress"),
  }

  const priorityBadge = (priority: string) => ({
    label: priorityLabel(priority),
    tone: TASK_PRIORITY_TONES[priority] ?? "neutral",
  })

  const modeIcon = { board: LayoutGrid, list: List, table: Table2 } as const
  const modeLabel = {
    board: t("tasks.board.boardView"),
    list: t("tasks.board.listView"),
    table: t("tasks.board.tableView"),
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)} data-testid="task-board-view">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("tasks.board.searchPlaceholder")}
            aria-label={t("tasks.board.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        {projects && projects.length > 0 ? (
          <Select value={projectFilter} onValueChange={(value) => setProjectFilter(String(value))}>
            <SelectTrigger className="w-full sm:w-48" aria-label={t("tasks.board.allProjects")}>
              <SelectValue placeholder={t("tasks.board.allProjects")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("tasks.board.allProjects")}</SelectItem>
              {projects.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={assigneeFilter} onValueChange={(value) => setAssigneeFilter(String(value))}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t("tasks.board.assigneeFilterPlaceholder")}>
            <Users className="mr-1 h-4 w-4 text-muted-foreground" />
            <SelectValue placeholder={t("tasks.board.assigneeFilterPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("tasks.board.allMembers")}</SelectItem>
            <SelectItem value={UNASSIGNED}>{t("tasks.assignee.unassigned")}</SelectItem>
            {people.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {people.length > 0 ? (
          <div className="hidden lg:block">
            <AvatarStack people={people} size="md" max={5} />
          </div>
        ) : null}

        <div
          className="flex items-center rounded-lg border border-border p-1 sm:ml-auto"
          role="group"
          aria-label={t("common.entityView.toggleLabel", { defaultValue: "Switch view" })}
        >
          {modes.map((mode) => {
            const Icon = modeIcon[mode]
            return (
              <Button
                key={mode}
                variant={viewMode === mode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5 px-2"
                onClick={() => changeMode(mode)}
                aria-pressed={viewMode === mode}
                data-testid={`task-view-${mode}`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{modeLabel[mode]}</span>
              </Button>
            )
          })}
        </div>
      </div>

      {viewMode === "board" ? (
        <KanbanBoard<TaskBoardItem>
          columns={columns}
          items={visible}
          getItemId={(item) => item.id}
          getColumnId={(item) => item.columnId}
          onItemClick={onTaskClick ? (item) => onTaskClick(item.id) : undefined}
          onAddItem={onCreateInColumn}
          onMove={({ itemId, toColumnId }) => onMove(itemId, toColumnId)}
          labels={{
            emptyColumn: t("tasks.board.dropTasksHere"),
            wipLimitReached: (limit) => t("tasks.board.wipLimitReached", { limit }),
          }}
          className="min-h-0 flex-1"
          renderCard={(item) => (
            <KanbanCardContent
              title={item.title}
              subtitle={item.projectName}
              priority={priorityBadge(item.priority)}
              assignees={item.assignees}
              dueLabel={formatDue(item.dueAt)}
              overdue={isOverdue(item, now)}
              commentCount={item.commentCount}
              attachmentCount={item.attachmentCount}
              progress={item.progress}
              labels={cardLabels}
            />
          )}
        />
      ) : null}

      {viewMode === "list" ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" data-testid="task-list-view">
          {columns.map((column) => {
            const rows = visible.filter((item) => item.columnId === column.id)
            const isCollapsed = collapsed.has(column.id)
            return (
              <section key={column.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(column.id)) next.delete(column.id)
                      else next.add(column.id)
                      return next
                    })
                  }
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
                  {column.colorClass ? <span className={cn("h-2.5 w-2.5 rounded-full", column.colorClass)} /> : null}
                  <span className="text-sm font-semibold">{column.title}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {rows.length}
                  </span>
                </button>
                {!isCollapsed ? (
                  rows.length === 0 ? (
                    <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                      {t("tasks.board.emptyColumn")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border border-t border-border">
                      {rows.map((item) => {
                        const overdue = isOverdue(item, now)
                        const badge = priorityBadge(item.priority)
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-muted/40 sm:flex-nowrap"
                              onClick={onTaskClick ? () => onTaskClick(item.id) : undefined}
                              data-testid={`task-list-row-${item.id}`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{item.title}</span>
                                {item.projectName ? (
                                  <span className="block truncate text-xs text-muted-foreground">{item.projectName}</span>
                                ) : null}
                              </span>
                              <Badge
                                variant={
                                  badge.tone === "neutral"
                                    ? "secondary"
                                    : badge.tone
                                }
                                className="h-5 px-1.5 text-[10px]"
                              >
                                {badge.label}
                              </Badge>
                              <span
                                className={cn(
                                  "w-16 text-xs tabular-nums text-muted-foreground",
                                  overdue && "font-medium text-destructive",
                                )}
                              >
                                {formatDue(item.dueAt) ?? "—"}
                              </span>
                              <span className="flex w-20 justify-end">
                                {item.assignees.length > 0 ? (
                                  <AvatarStack people={item.assignees} />
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {t("tasks.assignee.unassigned")}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}

      {viewMode === "table" && renderTable ? (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="task-table-view">
          {renderTable(visibleIds)}
        </div>
      ) : null}
    </div>
  )
}
