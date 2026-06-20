"use client"

import { KanbanColumn } from "../kanban/kanban-column"
import { KanbanDraggableCard } from "../kanban/kanban-draggable-card"
import { TaskCardContent } from "./task-card"
import type { Task, TaskColumn as TaskColumnType } from "@/lib/task-board-types"

interface TaskColumnProps {
  column: TaskColumnType
  tasks: Task[]
  onTaskClick: (task: Task) => void
  onAddTask?: () => void
}

/** Legacy column primitive — prefer {@link KanbanBoard} for new boards. Must be rendered inside `DndContext`. */
export function TaskColumn({ column, tasks, onTaskClick, onAddTask }: TaskColumnProps) {
  return (
    <KanbanColumn
      column={{
        id: column.id,
        title: column.title,
        colorClass: column.color,
        limit: column.limit,
      }}
      itemCount={tasks.length}
      onAddItem={onAddTask}
      labels={{
        emptyColumn: "Drop tasks here",
        wipLimitReached: (limit) => `WIP limit reached (${limit})`,
      }}
    >
      {tasks.map((task) => (
        <KanbanDraggableCard
          key={task.id}
          id={task.id}
          data={{ task }}
          onClick={() => onTaskClick(task)}
        >
          <TaskCardContent task={task} />
        </KanbanDraggableCard>
      ))}
    </KanbanColumn>
  )
}
