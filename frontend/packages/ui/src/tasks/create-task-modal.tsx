"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
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
  const { t } = useTranslation()
  const typeLabels: Record<TaskType, string> = {
    task: t("tasks.types.task"),
    bug: t("tasks.types.bug"),
    feature: t("tasks.types.feature"),
    story: t("tasks.types.story"),
    epic: t("tasks.types.epic"),
  }
  const priorityLabels: Record<TaskPriority, string> = {
    low: t("tasks.priorities.low"),
    medium: t("tasks.priorities.medium"),
    high: t("tasks.priorities.high"),
    urgent: t("tasks.priorities.urgent"),
  }
  const statusLabels: Record<TaskStatus, string> = {
    backlog: t("tasks.statuses.backlog"),
    todo: t("tasks.statuses.todo"),
    "in-progress": t("tasks.statuses.in-progress"),
    review: t("tasks.statuses.review"),
    done: t("tasks.statuses.done"),
  }
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
      reporterName: t("tasks.identity.currentUser"),
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
          <DialogTitle>{t("tasks.create.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">{t("tasks.fields.requiredTitle")}</Label>
            <Input
              id="title"
              placeholder={t("tasks.create.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">{t("tasks.fields.description")}</Label>
            <Textarea
              id="description"
              placeholder={t("tasks.create.descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Type and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("tasks.fields.type")}</Label>
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(taskTypeConfig) as TaskType[]).map((taskType) => (
                    <SelectItem key={taskType} value={taskType}>
                      <div className="flex items-center gap-2">
                        <span className={taskTypeConfig[taskType].color.replace("bg-", "text-")}>
                          {typeIcons[taskType]}
                        </span>
                        {typeLabels[taskType]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("tasks.fields.priority")}</Label>
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
                        {priorityLabels[p]}
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
              <Label>{t("tasks.fields.status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {defaultColumns.map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", col.color)} />
                        {statusLabels[col.id]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("tasks.fields.assignee")}</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("tasks.assignee.select")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">{t("tasks.assignee.unassigned")}</SelectItem>
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
              <Label htmlFor="dueDate">{t("tasks.fields.dueDate")}</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="storyPoints">{t("tasks.fields.storyPoints")}</Label>
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
            <Label htmlFor="labels">{t("tasks.fields.labelsCommaSeparated")}</Label>
            <Input
              id="labels"
              placeholder={t("tasks.create.labelsPlaceholder")}
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            {t("tasks.actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
