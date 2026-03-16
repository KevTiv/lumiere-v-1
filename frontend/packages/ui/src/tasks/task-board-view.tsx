"use client"

import { useState, useMemo } from "react"
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  Search,
  Filter,
  Plus,
  Users,
  Calendar,
  LayoutGrid,
  List,
  MoreHorizontal,
  Target,
  TrendingUp,
  CheckCircle2,
} from "lucide-react"
import { TaskColumn } from "./task-column"
import { TaskCard } from "./task-card"
import { TaskDetailModal } from "./task-detail-modal"
import { CreateTaskModal } from "./create-task-modal"
import {
  defaultColumns,
  sampleTasks,
  sampleTeamMembers,
  sampleSprint,
  type Task,
  type TaskStatus,
  type TeamMember,
} from "@/lib/task-board-types"

interface TaskBoardViewProps {
  className?: string
}

export function TaskBoardView({ className }: TaskBoardViewProps) {
  const [tasks, setTasks] = useState<Task[]>(sampleTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterAssignee, setFilterAssignee] = useState<string>("all")
  const [viewMode, setViewMode] = useState<"board" | "list">("board")

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesSearch =
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.labels.some((label) =>
          label.toLowerCase().includes(searchQuery.toLowerCase())
        )
      const matchesAssignee =
        filterAssignee === "all" ||
        (filterAssignee === "unassigned" && !task.assigneeId) ||
        task.assigneeId === filterAssignee
      return matchesSearch && matchesAssignee
    })
  }, [tasks, searchQuery, filterAssignee])

  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      "in-progress": [],
      review: [],
      done: [],
    }
    filteredTasks.forEach((task) => {
      grouped[task.status].push(task)
    })
    return grouped
  }, [filteredTasks])

  // Sprint stats
  const sprintStats = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter((t) => t.status === "done").length
    const inProgress = tasks.filter((t) => t.status === "in-progress").length
    const totalPoints = tasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0)
    const completedPoints = tasks
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + (t.storyPoints || 0), 0)
    return { total, done, inProgress, totalPoints, completedPoints }
  }, [tasks])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const taskId = active.id as string
    const newStatus = over.id as TaskStatus

    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: newStatus, updatedAt: new Date().toISOString() }
          : task
      )
    )
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setIsDetailModalOpen(true)
  }

  const handleTaskSave = (updatedTask: Task) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === updatedTask.id ? updatedTask : task))
    )
    setSelectedTask(updatedTask)
  }

  const handleCreateTask = (newTask: Omit<Task, "id" | "key" | "createdAt" | "updatedAt" | "comments" | "attachments">) => {
    const task: Task = {
      ...newTask,
      id: `task-${Date.now()}`,
      key: `ERP-${100 + tasks.length + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
      attachments: [],
    }
    setTasks((prev) => [...prev, task])
    setIsCreateModalOpen(false)
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Sprint Header */}
      <div className="shrink-0 mb-6 p-4 bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{sampleSprint.name}</h2>
            <p className="text-sm text-muted-foreground">{sampleSprint.goal}</p>
          </div>
          <Badge
            variant={sampleSprint.status === "active" ? "default" : "secondary"}
            className="capitalize"
          >
            {sampleSprint.status}
          </Badge>
        </div>

        {/* Sprint Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Target className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{sprintStats.total}</p>
              <p className="text-xs text-muted-foreground">Total Tasks</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{sprintStats.inProgress}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{sprintStats.done}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Calendar className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {sprintStats.completedPoints}/{sprintStats.totalPoints}
              </p>
              <p className="text-xs text-muted-foreground">Story Points</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Assignee Filter */}
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-48">
              <Users className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Members</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {sampleTeamMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[10px]">
                        {member.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    {member.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Team Members */}
          <div className="flex items-center -space-x-2">
            {sampleTeamMembers.slice(0, 5).map((member) => (
              <Avatar
                key={member.id}
                className="h-8 w-8 border-2 border-background"
                title={member.name}
              >
                <AvatarFallback className="text-xs">
                  {member.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
            ))}
            {sampleTeamMembers.length > 5 && (
              <div className="h-8 w-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium">
                +{sampleTeamMembers.length - 5}
              </div>
            )}
          </div>
        </div>

        {/* View Toggle and Create */}
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-border rounded-lg p-1">
            <Button
              variant={viewMode === "board" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("board")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Task
          </Button>
        </div>
      </div>

      {/* Board View */}
      {viewMode === "board" && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-4 h-full pb-4">
              {defaultColumns.map((column) => (
                <TaskColumn
                  key={column.id}
                  column={column}
                  tasks={tasksByStatus[column.id]}
                  onTaskClick={handleTaskClick}
                  onAddTask={
                    column.id !== "done"
                      ? () => setIsCreateModalOpen(true)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>

          <DragOverlay>
            {activeTask ? (
              <TaskCard task={activeTask} isDragOverlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-3 font-medium">Key</th>
                <th className="p-3 font-medium">Title</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Priority</th>
                <th className="p-3 font-medium">Assignee</th>
                <th className="p-3 font-medium">Due Date</th>
                <th className="p-3 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleTaskClick(task)}
                >
                  <td className="p-3 text-sm font-mono text-muted-foreground">
                    {task.key}
                  </td>
                  <td className="p-3 text-sm font-medium">{task.title}</td>
                  <td className="p-3">
                    <Badge variant="outline" className="capitalize">
                      {task.status.replace("-", " ")}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        "capitalize",
                        task.priority === "urgent" && "border-red-500 text-red-500",
                        task.priority === "high" && "border-orange-500 text-orange-500"
                      )}
                    >
                      {task.priority}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {task.assigneeName ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-xs">
                            {task.assigneeName
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{task.assigneeName}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-sm">
                    {task.dueDate
                      ? new Date(task.dueDate).toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="p-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleTaskClick(task)}>
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Detail Modal */}
      <TaskDetailModal
        task={selectedTask}
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        onSave={handleTaskSave}
        teamMembers={sampleTeamMembers}
      />

      {/* Create Task Modal */}
      <CreateTaskModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onCreate={handleCreateTask}
        teamMembers={sampleTeamMembers}
      />
    </div>
  )
}
