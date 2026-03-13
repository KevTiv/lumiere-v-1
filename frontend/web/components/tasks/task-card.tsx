"use client"

import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
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

const typeColors: Record<TaskType, string> = {
  task: "text-blue-500",
  bug: "text-red-500",
  feature: "text-green-500",
  story: "text-purple-500",
  epic: "text-violet-500",
}

const priorityIcons: Record<TaskPriority, React.ReactNode> = {
  low: <ArrowDown className="h-3.5 w-3.5" />,
  medium: <Minus className="h-3.5 w-3.5" />,
  high: <ArrowUp className="h-3.5 w-3.5" />,
  urgent: <AlertTriangle className="h-3.5 w-3.5" />,
}

const priorityColors: Record<TaskPriority, string> = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-orange-500",
  urgent: "text-red-500",
}

export function TaskCard({ task, onClick, isDragOverlay }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
  }

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date()

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing",
        "hover:border-primary/50 hover:shadow-md transition-all",
        "select-none touch-none",
        isDragging && "opacity-50 shadow-lg",
        isDragOverlay && "shadow-xl rotate-2 scale-105"
      )}
    >
      {/* Type and Key */}
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("shrink-0", typeColors[task.type])}>
          {typeIcons[task.type]}
        </span>
        <span className="text-xs font-mono text-muted-foreground">{task.key}</span>
        <span className={cn("ml-auto shrink-0", priorityColors[task.priority])}>
          {priorityIcons[task.priority]}
        </span>
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-foreground line-clamp-2 mb-2">
        {task.title}
      </h4>

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.labels.slice(0, 3).map((label) => (
            <Badge
              key={label}
              variant="secondary"
              className="text-[10px] px-1.5 py-0 h-4"
            >
              {label}
            </Badge>
          ))}
          {task.labels.length > 3 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
              +{task.labels.length - 3}
            </Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          {/* Story Points */}
          {task.storyPoints && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">
              {task.storyPoints} SP
            </Badge>
          )}

          {/* Due Date */}
          {task.dueDate && (
            <div
              className={cn(
                "flex items-center gap-1 text-[10px]",
                isOverdue ? "text-red-500" : "text-muted-foreground"
              )}
            >
              <Calendar className="h-3 w-3" />
              {new Date(task.dueDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </div>
          )}

          {/* Comments */}
          {task.comments.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {task.comments.length}
            </div>
          )}
        </div>

        {/* Assignee */}
        {task.assigneeName && (
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
              {task.assigneeName
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </div>
  )
}
