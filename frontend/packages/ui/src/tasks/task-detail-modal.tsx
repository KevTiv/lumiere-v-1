"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
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
  Calendar,
  User,
  Tag,
  MessageSquare,
  Clock,
  Send,
  X,
  Edit2,
  Save,
} from "lucide-react"
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  TeamMember,
} from "@/lib/task-board-types"
import { defaultColumns, priorityConfig, taskTypeConfig } from "@/lib/task-board-types"

interface TaskDetailModalProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (task: Task) => void
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

export function TaskDetailModal({
  task,
  open,
  onOpenChange,
  onSave,
  teamMembers,
}: TaskDetailModalProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
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
  const [isEditing, setIsEditing] = useState(false)
  const [editedTask, setEditedTask] = useState<Task | null>(null)
  const [newComment, setNewComment] = useState("")

  if (!task) return null

  const currentTask = isEditing && editedTask ? editedTask : task

  const handleEdit = () => {
    setEditedTask({ ...task })
    setIsEditing(true)
  }

  const handleSave = () => {
    if (editedTask) {
      onSave({ ...editedTask, updatedAt: new Date().toISOString() })
    }
    setIsEditing(false)
    setEditedTask(null)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditedTask(null)
  }

  const updateField = <K extends keyof Task>(field: K, value: Task[K]) => {
    if (editedTask) {
      setEditedTask({ ...editedTask, [field]: value })
    }
  }

  const handleStatusChange = (status: TaskStatus) => {
    const updatedTask = { ...task, status, updatedAt: new Date().toISOString() }
    onSave(updatedTask)
  }

  const handleAddComment = () => {
    if (!newComment.trim()) return
    const comment = {
      id: `comment-${Date.now()}`,
      userId: "user-1",
      userName: t("tasks.identity.currentUser"),
      content: newComment,
      createdAt: new Date().toISOString(),
    }
    const updatedTask = {
      ...task,
      comments: [...task.comments, comment],
      updatedAt: new Date().toISOString(),
    }
    onSave(updatedTask)
    setNewComment("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn("", taskTypeConfig[currentTask.type].color.replace("bg-", "text-"))}>
                {typeIcons[currentTask.type]}
              </span>
              <span className="text-sm font-mono text-muted-foreground">
                {currentTask.key}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <Button size="sm" variant="ghost" onClick={handleCancel}>
                    <X className="h-4 w-4 mr-1" />
                    {t("common.cancel")}
                  </Button>
                  <Button size="sm" onClick={handleSave}>
                    <Save className="h-4 w-4 mr-1" />
                    {t("common.save")}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={handleEdit}>
                  <Edit2 className="h-4 w-4 mr-1" />
                  {t("common.edit")}
                </Button>
              )}
            </div>
          </div>
          <DialogTitle className="text-lg mt-2">
            {isEditing ? (
              <Input
                value={editedTask?.title || ""}
                onChange={(e) => updateField("title", e.target.value)}
                className="text-lg font-semibold"
              />
            ) : (
              currentTask.title
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 gap-6 py-4">
            {/* Main Content */}
            <div className="col-span-2 space-y-4">
              {/* Description */}
              <div>
                <h4 className="text-sm font-medium mb-2">{t("tasks.fields.description")}</h4>
                {isEditing ? (
                  <Textarea
                    value={editedTask?.description || ""}
                    onChange={(e) => updateField("description", e.target.value)}
                    rows={4}
                    placeholder={t("tasks.detail.descriptionPlaceholder")}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {currentTask.description || t("tasks.detail.noDescription")}
                  </p>
                )}
              </div>

              {/* Comments */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  {t("tasks.detail.commentsCount", { count: currentTask.comments.length })}
                </h4>
                <div className="space-y-3">
                  {currentTask.comments.map((comment) => (
                    <div
                      key={comment.id}
                      className="flex gap-3 p-3 rounded-lg bg-muted/50"
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="text-xs">
                          {comment.userName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">
                            {comment.userName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(comment.createdAt).toLocaleString(locale)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground">{comment.content}</p>
                      </div>
                    </div>
                  ))}

                  {/* Add Comment */}
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("tasks.detail.commentPlaceholder")}
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                    />
                    <Button size="icon" onClick={handleAddComment} aria-label={t("tasks.actions.addComment")}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Status */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  {t("tasks.fields.status")}
                </h4>
                <Select
                  value={currentTask.status}
                  onValueChange={(value) => handleStatusChange(value as TaskStatus)}
                >
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

              {/* Priority */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  {t("tasks.fields.priority")}
                </h4>
                {isEditing ? (
                  <Select
                    value={editedTask?.priority}
                    onValueChange={(value) =>
                      updateField("priority", value as TaskPriority)
                    }
                  >
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
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={priorityConfig[currentTask.priority].color}>
                      {priorityIcons[currentTask.priority]}
                    </span>
                    <span className="text-sm">
                      {priorityLabels[currentTask.priority]}
                    </span>
                  </div>
                )}
              </div>

              {/* Assignee */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {t("tasks.fields.assignee")}
                </h4>
                {isEditing ? (
                  <Select
                    value={editedTask?.assigneeId || "unassigned"}
                    onValueChange={(value) => {
                      if (value === "unassigned") {
                        updateField("assigneeId", undefined)
                        updateField("assigneeName", undefined)
                      } else {
                        const member = teamMembers.find((m) => m.id === value)
                        updateField("assigneeId", value)
                        updateField("assigneeName", member?.name)
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("tasks.assignee.unassigned")} />
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
                ) : currentTask.assigneeName ? (
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {currentTask.assigneeName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{currentTask.assigneeName}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("tasks.assignee.unassigned")}</span>
                )}
              </div>

              {/* Due Date */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {t("tasks.fields.dueDate")}
                </h4>
                {isEditing ? (
                  <Input
                    type="date"
                    value={editedTask?.dueDate || ""}
                    onChange={(e) => updateField("dueDate", e.target.value)}
                  />
                ) : currentTask.dueDate ? (
                  <span className="text-sm">
                    {new Date(currentTask.dueDate).toLocaleDateString(locale)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("tasks.detail.notSet")}</span>
                )}
              </div>

              {/* Labels */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {t("tasks.fields.labels")}
                </h4>
                <div className="flex flex-wrap gap-1">
                  {currentTask.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-xs">
                      {label}
                    </Badge>
                  ))}
                  {currentTask.labels.length === 0 && (
                    <span className="text-sm text-muted-foreground">{t("tasks.detail.noLabels")}</span>
                  )}
                </div>
              </div>

              {/* Story Points */}
              {currentTask.storyPoints !== undefined && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    {t("tasks.fields.storyPoints")}
                  </h4>
                  {isEditing ? (
                    <Input
                      type="number"
                      min={0}
                      value={editedTask?.storyPoints || ""}
                      onChange={(e) =>
                        updateField("storyPoints", parseInt(e.target.value) || undefined)
                      }
                    />
                  ) : (
                    <span className="text-sm">{currentTask.storyPoints}</span>
                  )}
                </div>
              )}

              {/* Timestamps */}
              <div className="pt-4 border-t border-border space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t("tasks.detail.createdOn", {
                    date: new Date(currentTask.createdAt).toLocaleDateString(locale),
                  })}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t("tasks.detail.updatedOn", {
                    date: new Date(currentTask.updatedAt).toLocaleDateString(locale),
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
