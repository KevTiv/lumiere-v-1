"use client"

import { useState } from "react"
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
      userName: "Current User",
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
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave}>
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={handleEdit}>
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
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
                <h4 className="text-sm font-medium mb-2">Description</h4>
                {isEditing ? (
                  <Textarea
                    value={editedTask?.description || ""}
                    onChange={(e) => updateField("description", e.target.value)}
                    rows={4}
                    placeholder="Add a description..."
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {currentTask.description || "No description provided"}
                  </p>
                )}
              </div>

              {/* Comments */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Comments ({currentTask.comments.length})
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
                            {new Date(comment.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-foreground">{comment.content}</p>
                      </div>
                    </div>
                  ))}

                  {/* Add Comment */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a comment..."
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                    />
                    <Button size="icon" onClick={handleAddComment}>
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
                  Status
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
                          {col.title}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  Priority
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
                            {priorityConfig[p].label}
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
                      {priorityConfig[currentTask.priority].label}
                    </span>
                  </div>
                )}
              </div>

              {/* Assignee */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Assignee
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
                      <SelectValue placeholder="Unassigned" />
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
                  <span className="text-sm text-muted-foreground">Unassigned</span>
                )}
              </div>

              {/* Due Date */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Due Date
                </h4>
                {isEditing ? (
                  <Input
                    type="date"
                    value={editedTask?.dueDate || ""}
                    onChange={(e) => updateField("dueDate", e.target.value)}
                  />
                ) : currentTask.dueDate ? (
                  <span className="text-sm">
                    {new Date(currentTask.dueDate).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Not set</span>
                )}
              </div>

              {/* Labels */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  Labels
                </h4>
                <div className="flex flex-wrap gap-1">
                  {currentTask.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-xs">
                      {label}
                    </Badge>
                  ))}
                  {currentTask.labels.length === 0 && (
                    <span className="text-sm text-muted-foreground">No labels</span>
                  )}
                </div>
              </div>

              {/* Story Points */}
              {currentTask.storyPoints !== undefined && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                    Story Points
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
                  Created:{" "}
                  {new Date(currentTask.createdAt).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Updated:{" "}
                  {new Date(currentTask.updatedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
