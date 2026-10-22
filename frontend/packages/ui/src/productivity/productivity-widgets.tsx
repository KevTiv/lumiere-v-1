"use client"

import { useMemo, useState, type ComponentType } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { BookOpen, CalendarClock, CalendarDays, FileText, FolderKanban } from "lucide-react"
import { cn } from "../lib/utils"
import type { CustomWidget, GridWidth } from "../lib/dashboard-types"
import { Badge } from "../components/badge"
import { Calendar } from "../components/calendar"
import { Checkbox } from "../components/checkbox"
import { Progress } from "../components/progress"
import { AvatarStack, type KanbanCardPerson, type KanbanCardTone } from "../kanban/kanban-card"

/** A dashboard `custom` widget whose component and data are checked against each other. */
export function customDashboardWidget<T>(widget: {
  id: string
  title: string
  width: GridWidth
  useCard?: boolean
  component: ComponentType<{ data: T }>
  data: T
}): CustomWidget {
  return {
    ...widget,
    type: "custom",
    // The pairing above is what makes this safe: the renderer passes `data` back unchanged.
    component: widget.component as ComponentType<{ data: unknown }>,
  }
}

function MaybeLink({ href, className, children }: { href?: string; className?: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  )
}

function useShortDate() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  return (ms: number) => new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" })
}

// ─── Today's tasks ──────────────────────────────────────────────────────────

export interface WorkTaskItem {
  id: string
  title: string
  projectName?: string
  /** Epoch ms. */
  dueAt: number | null
  done: boolean
  priority?: { label: string; tone: KanbanCardTone }
  href?: string
}

export interface TodayTasksData {
  tasks: WorkTaskItem[]
  /** Ticking a task marks it done; omitted shows read-only checkboxes. */
  onToggleDone?: (taskId: string, done: boolean) => void | Promise<void>
  viewAllHref?: string
}

const TONE_BADGE = { neutral: "secondary", info: "info", warning: "warning", destructive: "destructive", success: "success" } as const

export function TodayTasksWidget({ data }: { data: TodayTasksData }) {
  const { t } = useTranslation()
  const shortDate = useShortDate()
  const now = Date.now()
  const endOfToday = new Date().setHours(23, 59, 59, 999)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const toggle = async (task: WorkTaskItem) => {
    if (!data.onToggleDone || busy.has(task.id)) return
    setBusy((prev) => new Set(prev).add(task.id))
    try {
      await data.onToggleDone(task.id, !task.done)
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
    }
  }

  if (data.tasks.length === 0) {
    return (
      <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground" data-testid="today-tasks-empty">
        <CalendarClock className="h-5 w-5" />
        {t("workspace.todayTasks.empty")}
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="today-tasks">
      <ul className="divide-y divide-border">
        {data.tasks.map((task) => {
          const overdue = !task.done && task.dueAt != null && task.dueAt < now
          const dueToday = task.dueAt != null && task.dueAt >= now && task.dueAt <= endOfToday
          return (
            <li key={task.id} className="flex items-center gap-3 py-2" data-testid={`today-task-${task.id}`}>
              <Checkbox
                checked={task.done}
                disabled={!data.onToggleDone || busy.has(task.id)}
                onCheckedChange={() => void toggle(task)}
                aria-label={t("workspace.todayTasks.toggle", { title: task.title })}
              />
              <div className="min-w-0 flex-1">
                <MaybeLink
                  href={task.href}
                  className={cn("block truncate text-sm font-medium hover:underline", task.done && "text-muted-foreground line-through")}
                >
                  {task.title}
                </MaybeLink>
                {task.projectName ? <p className="truncate text-xs text-muted-foreground">{task.projectName}</p> : null}
              </div>
              {task.priority ? (
                <Badge variant={TONE_BADGE[task.priority.tone]} className="hidden h-5 px-1.5 text-[10px] sm:inline-flex">
                  {task.priority.label}
                </Badge>
              ) : null}
              <span
                className={cn(
                  "w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground",
                  overdue && "font-medium text-destructive",
                  dueToday && "font-medium text-foreground",
                )}
              >
                {task.dueAt == null ? "—" : dueToday ? t("workspace.todayTasks.today") : shortDate(task.dueAt)}
              </span>
            </li>
          )
        })}
      </ul>
      {data.viewAllHref ? (
        <Link href={data.viewAllHref} className="inline-block text-xs font-medium text-primary hover:underline">
          {t("workspace.viewAll")}
        </Link>
      ) : null}
    </div>
  )
}

// ─── Project progress ───────────────────────────────────────────────────────

export interface ProjectProgressItem {
  id: string
  name: string
  /** 0–100. */
  progress: number
  openTasks: number
  totalTasks: number
  /** Epoch ms. */
  dueAt: number | null
  members: KanbanCardPerson[]
  href?: string
}

export interface ProjectProgressData {
  projects: ProjectProgressItem[]
}

export function ProjectProgressWidget({ data }: { data: ProjectProgressData }) {
  const { t } = useTranslation()
  const shortDate = useShortDate()
  if (data.projects.length === 0) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <FolderKanban className="h-5 w-5" />
        {t("workspace.projects.empty")}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="project-progress">
      {data.projects.map((project) => (
        <MaybeLink
          key={project.id}
          href={project.href}
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 transition-colors hover:border-primary/40"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{project.name}</p>
            <span className="shrink-0 text-xs font-semibold tabular-nums">{Math.round(project.progress)}%</span>
          </div>
          <Progress value={project.progress} aria-label={t("workspace.projects.progress", { name: project.name })} />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t("workspace.projects.openTasks", { open: project.openTasks, total: project.totalTasks })}
              {project.dueAt != null ? ` · ${t("workspace.projects.due", { date: shortDate(project.dueAt) })}` : ""}
            </span>
            <AvatarStack people={project.members} />
          </div>
        </MaybeLink>
      ))}
    </div>
  )
}

// ─── Mini calendar ──────────────────────────────────────────────────────────

export interface AgendaItem {
  id: string
  title: string
  /** Epoch ms. */
  at: number
  kind: "event" | "deadline"
  href?: string
}

export interface MiniCalendarData {
  items: AgendaItem[]
  calendarHref?: string
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

export function MiniCalendarWidget({ data }: { data: MiniCalendarData }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [selected, setSelected] = useState<Date>(() => new Date())
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const item of data.items) {
      const key = dayKey(new Date(item.at))
      map.set(key, [...(map.get(key) ?? []), item])
    }
    for (const list of map.values()) list.sort((a, b) => a.at - b.at)
    return map
  }, [data.items])
  const busyDays = useMemo(() => data.items.map((item) => new Date(item.at)), [data.items])
  const agenda = byDay.get(dayKey(selected)) ?? []

  return (
    <div className="flex flex-col gap-3" data-testid="mini-calendar">
      <Calendar
        mode="single"
        required
        selected={selected}
        onSelect={setSelected}
        modifiers={{ busy: busyDays }}
        modifiersClassNames={{
          busy: "relative after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
        }}
        className="mx-auto p-0 [--cell-size:--spacing(8)]"
      />
      <div className="space-y-1.5 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          {selected.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" })}
        </p>
        {agenda.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("workspace.calendar.nothing")}</p>
        ) : (
          <ul className="space-y-1.5">
            {agenda.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center gap-2 text-sm">
                {item.kind === "event" ? (
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-info" aria-label={t("workspace.calendar.event")} />
                ) : (
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={t("workspace.calendar.deadline")} />
                )}
                <MaybeLink href={item.href} className="min-w-0 flex-1 truncate hover:underline">
                  {item.title}
                </MaybeLink>
                {item.kind === "event" ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {new Date(item.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.calendarHref ? (
          <Link href={data.calendarHref} className="inline-block text-xs font-medium text-primary hover:underline">
            {t("workspace.calendar.open")}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

// ─── Recent notes ───────────────────────────────────────────────────────────

export interface RecentNoteItem {
  id: string
  title: string
  excerpt?: string
  /** Epoch ms. */
  updatedAt: number | null
  kind: "article" | "document"
  href?: string
}

export interface RecentNotesData {
  notes: RecentNoteItem[]
}

export function RecentNotesWidget({ data }: { data: RecentNotesData }) {
  const { t } = useTranslation()
  const shortDate = useShortDate()
  if (data.notes.length === 0) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <BookOpen className="h-5 w-5" />
        {t("workspace.notes.empty")}
      </div>
    )
  }
  return (
    <ul className="space-y-1" data-testid="recent-notes">
      {data.notes.map((note) => {
        const Icon = note.kind === "article" ? BookOpen : FileText
        return (
          <li key={`${note.kind}-${note.id}`}>
            <MaybeLink href={note.href} className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/50">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", note.kind === "article" ? "bg-category-3/10 text-category-3" : "bg-info/10 text-info")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{note.title}</span>
                {note.excerpt ? <span className="line-clamp-1 block text-xs text-muted-foreground">{note.excerpt}</span> : null}
              </span>
              {note.updatedAt != null ? (
                <span className="shrink-0 text-xs text-muted-foreground">{shortDate(note.updatedAt)}</span>
              ) : null}
            </MaybeLink>
          </li>
        )
      })}
    </ul>
  )
}
