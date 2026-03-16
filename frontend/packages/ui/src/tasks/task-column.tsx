"use client"

import { useDroppable } from "@dnd-kit/core"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { TaskCard } from "./task-card"
import type { Task, TaskColumn as TaskColumnType } from "@/lib/task-board-types"

interface TaskColumnProps {
  column: TaskColumnType
  tasks: Task[]
  onTaskClick: (task: Task) => void
  onAddTask?: () => void
}

export function TaskColumn({ column, tasks, onTaskClick, onAddTask }: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { column },
  })

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Column Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className={cn("w-2.5 h-2.5 rounded-full", column.color)} />
          <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {tasks.length}
          </span>
        </div>
        {onAddTask && column.id !== "done" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onAddTask}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Tasks Container */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 p-2 rounded-lg bg-muted/30 border-2 border-dashed border-transparent transition-colors space-y-2 min-h-[200px]",
          isOver && "border-primary/50 bg-primary/5"
        )}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick(task)}
          />
        ))}

        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
            Drop tasks here
          </div>
        )}
      </div>

      {/* Column WIP Limit */}
      {column.limit && tasks.length >= column.limit && (
        <div className="mt-2 px-2 py-1 text-xs text-amber-600 bg-amber-500/10 rounded">
          WIP limit reached ({column.limit})
        </div>
      )}
    </div>
  )
}
