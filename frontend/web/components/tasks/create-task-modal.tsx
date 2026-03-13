"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
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
} from "lucide-react"
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  TeamMember,
} from "@/lib/task-board-types"
import { defaultColumns, priorityConfig, taskTypeConfig } from "@/lib/task-board-types"

interface CreateTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (task: Omit<Task, "id" | "key" | "createdAt" | "updatedAt" | "comments" | "attachments">) => void
  teamMembers: TeamMember[]
}

const typeIcons: Record<TaskType, React.ReactNode> = {
  task: <CheckSquare className="h-4 w-4" />,
  bug: <Bug className="h-4 w-4" />,
  feature: <Zap className="h-4 w-4" />,
  story: <BookOpen className="h-4 w-4" />,
  epic: <Layers className="h-4 w-4" />,
}

const priorityIcons: Record<TaskPriority, React.ReactNode> = {
  low: <ArrowDown className="h-4 w-4" />,
  medium: <Minus className="h-4 w-4" />,
  high: <ArrowUp className="h-4 w-4" />,
  urgent: <AlertTriangle className="h-4 w-4" />,
}

export function CreateTaskModal({
  open,
  onOpenChange,
  onCreate,
  teamMembers,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [type, setType] = useState<TaskType>("task")
  const [status, setStatus] = useState<TaskStatus>("todo")
  const [priority, setPriority] = useState<TaskPriority>("medium")
  const [assigneeId, setAssigneeId] = useState<string>("")
  const [dueDate, setDueDate] = useState("")
  const [storyPoints, setStoryPoints] = useState("")
  const [labels, setLabels] = useState("")

  const handleSubmit = () => {
    if (!title.trim()) return

    const assignee = teamMembers.find((m) => m.id === assigneeId)

    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      status,
      priority,
      assigneeId: assigneeId || undefined,
      assigneeName: assignee?.name,
      reporterId: "user-1",
      reporterName: "Current User",
      labels: labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      storyPoints: storyPoints ? parseInt(storyPoints) : undefined,
      dueDate: dueDate || undefined,
    })

    // Reset form
    setTitle("")
    setDescription("")
    setType("task")
    setStatus("todo")
    setPriority("medium")
    setAssigneeId("")
    setDueDate("")
    setStoryPoints("")
    setLabels("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="Enter task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter task description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Type and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(taskTypeConfig) as TaskType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      <div className="flex items-center gap-2">
                        <span className={taskTypeConfig[t].color.replace("bg-", "text-")}>
                          {typeIcons[t]}
                        </span>
                        {taskTypeConfig[t].label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(priorityConfig) as TaskPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      <div className="flex items-center gap-2">
                        <span className={priorityConfig[p].color}>
                          {priorityIcons[p]}
                        </span>
                        {priorityConfig[p].label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status and Assignee */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {defaultColumns.map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", col.color)} />
                        {col.title}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers.map((member) => (
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
            </div>
          </div>

          {/* Due Date and Story Points */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="storyPoints">Story Points</Label>
              <Input
                id="storyPoints"
                type="number"
                min={0}
                placeholder="0"
                value={storyPoints}
                onChange={(e) => setStoryPoints(e.target.value)}
              />
            </div>
          </div>

          {/* Labels */}
          <div className="space-y-2">
            <Label htmlFor="labels">Labels (comma-separated)</Label>
            <Input
              id="labels"
              placeholder="frontend, bug-fix, urgent"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
