"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  CheckSquare,
  Bug,
  Zap,
  BookOpen,
  Layers,
  ArrowUp,
  ArrowDown,
  Minus,
  AlertTriangle,
  Calendar,
  MessageSquare,
} from "lucide-react"
import type { Task, TaskType, TaskPriority } from "@/lib/task-board-types"
import { taskPriorityIconClass, taskTypeIconClass } from "@/lib/theme-colors"
import { KanbanDraggableCard } from "../kanban/kanban-draggable-card"

interface TaskCardProps {
  task: Task
  onClick?: () => void
  isDragOverlay?: boolean
}

const typeIcons: Record<TaskType, React.ReactNode> = {
  task: <CheckSquare className="h-3.5 w-3.5" />,
  bug: <Bug className="h-3.5 w-3.5" />,
  feature: <Zap className="h-3.5 w-3.5" />,
  story: <BookOpen className="h-3.5 w-3.5" />,
  epic: <Layers className="h-3.5 w-3.5" />,
}

const priorityIcons: Record<TaskPriority, React.ReactNode> = {
  low: <ArrowDown className="h-3.5 w-3.5" />,
  medium: <Minus className="h-3.5 w-3.5" />,
  high: <ArrowUp className="h-3.5 w-3.5" />,
  urgent: <AlertTriangle className="h-3.5 w-3.5" />,
}

export function TaskCardContent({ task }: { task: Task }) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date()

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("shrink-0", taskTypeIconClass[task.type] ?? "text-muted-foreground")}>
          {typeIcons[task.type]}
        </span>
        <span className="text-xs font-mono text-muted-foreground">{task.key}</span>
        <span
          className={cn(
            "ml-auto shrink-0",
            taskPriorityIconClass[task.priority] ?? "text-muted-foreground",
          )}
        >
          {priorityIcons[task.priority]}
        </span>
      </div>

      <h4 className="text-sm font-medium text-foreground line-clamp-2 mb-2">{task.title}</h4>

      {task.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.labels.slice(0, 3).map((label) => (
            <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {label}
            </Badge>
          ))}
          {task.labels.length > 3 ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              +{task.labels.length - 3}
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          {task.storyPoints ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">
              {task.storyPoints} SP
            </Badge>
          ) : null}

          {task.dueDate ? (
            <div
              className={cn(
                "flex items-center gap-1 text-[10px]",
                isOverdue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <Calendar className="h-3 w-3" />
              {new Date(task.dueDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </div>
          ) : null}

          {task.comments.length > 0 ? (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {task.comments.length}
            </div>
          ) : null}
        </div>

        {task.assigneeName ? (
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
              {task.assigneeName
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </AvatarFallback>
          </Avatar>
        ) : null}
      </div>
    </>
  )
}

/** Standalone draggable task card (legacy). Prefer {@link KanbanBoard} + {@link TaskCardContent}. */
export function TaskCard({ task, onClick, isDragOverlay }: TaskCardProps) {
  return (
    <KanbanDraggableCard
      id={task.id}
      data={{ task }}
      onClick={onClick}
      isDragOverlay={isDragOverlay}
    >
      <TaskCardContent task={task} />
    </KanbanDraggableCard>
  )
}
