"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import type { ReactNode } from "react"
import { CalendarDays, MessageSquare, Paperclip } from "lucide-react"
import { cn } from "../lib/utils"
import { Badge } from "../components/badge"
import { Avatar, AvatarFallback } from "../components/avatar"
import { Progress } from "../components/progress"

export type KanbanCardTone = "neutral" | "info" | "warning" | "destructive" | "success"

export interface KanbanCardPerson {
  id: string
  name: string
}

export interface KanbanCardProps {
  title: string
  /** Line under the title, e.g. the project a task belongs to. */
  subtitle?: string
  /** Badge in the card's top-left corner. */
  priority?: { label: string; tone: KanbanCardTone }
  assignees?: readonly KanbanCardPerson[]
  /** Already formatted for display. */
  dueLabel?: string
  overdue?: boolean
  commentCount?: number
  attachmentCount?: number
  /** 0–100; omitted hides the bar. */
  progress?: number | null
  /** Extra content on the top row, right-aligned (e.g. a menu). */
  topRight?: ReactNode
  labels?: {
    comments?: (count: number) => string
    attachments?: (count: number) => string
    progress?: string
  }
}

const PRIORITY_BADGE: Record<KanbanCardTone, "secondary" | "info" | "warning" | "destructive" | "success"> = {
  neutral: "secondary",
  info: "info",
  warning: "warning",
  destructive: "destructive",
  success: "success",
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
}

/** Avatar stack: the first three people, then "+N". */
export function AvatarStack({
  people,
  size = "sm",
  max = 3,
}: {
  people: readonly KanbanCardPerson[]
  size?: "sm" | "md"
  max?: number
}) {
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs"
  return (
    <div className="flex items-center -space-x-1.5" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((person) => (
        <Avatar key={person.id} className={cn(dim, "border-2 border-card")} title={person.name}>
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {initialsOf(person.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {rest > 0 ? (
        <span
          className={cn(
            dim,
            "flex items-center justify-center rounded-full border-2 border-card bg-muted font-medium text-muted-foreground",
          )}
        >
          +{rest}
        </span>
      ) : null}
    </div>
  )
}

/** Card body for a kanban item: priority, title, progress, people, due date and counts. */
export function KanbanCardContent({
  title,
  subtitle,
  priority,
  assignees = [],
  dueLabel,
  overdue,
  commentCount = 0,
  attachmentCount = 0,
  progress,
  topRight,
  labels,
}: KanbanCardProps) {
  useTranslation()
  const pct = progress == null || !Number.isFinite(progress) ? null : Math.max(0, Math.min(100, progress))
  const hasMeta = dueLabel || commentCount > 0 || attachmentCount > 0 || assignees.length > 0
  return (
    <div className="space-y-2.5">
      {priority || topRight ? (
        <div className="flex items-center gap-2">
          {priority ? (
            <Badge variant={PRIORITY_BADGE[priority.tone]} className="h-5 px-1.5 text-[10px]">
              {priority.label}
            </Badge>
          ) : null}
          {topRight ? <div className="ml-auto">{topRight}</div> : null}
        </div>
      ) : null}

      <div className="space-y-0.5">
        <h4 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{title}</h4>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>

      {pct != null ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{labels?.progress ?? i18n.t("ui.kanban.kanbanCard.progress")}</span>
            <span className="tabular-nums">{Math.round(pct)}%</span>
          </div>
          <Progress value={pct} aria-label={labels?.progress ?? i18n.t("ui.kanban.kanbanCard.progress")} />
        </div>
      ) : null}

      {hasMeta ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <div className="flex min-w-0 items-center gap-3 text-[11px] text-muted-foreground">
            {dueLabel ? (
              <span
                className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}
                data-overdue={overdue ? "true" : undefined}
              >
                <CalendarDays className="h-3 w-3" />
                {dueLabel}
              </span>
            ) : null}
            {commentCount > 0 ? (
              <span className="flex items-center gap-1" title={labels?.comments?.(commentCount)}>
                <MessageSquare className="h-3 w-3" />
                {commentCount}
              </span>
            ) : null}
            {attachmentCount > 0 ? (
              <span className="flex items-center gap-1" title={labels?.attachments?.(attachmentCount)}>
                <Paperclip className="h-3 w-3" />
                {attachmentCount}
              </span>
            ) : null}
          </div>
          <AvatarStack people={assignees} />
        </div>
      ) : null}
    </div>
  )
}
