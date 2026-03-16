// Jira-like Task Board Types

export type TaskStatus = "backlog" | "todo" | "in-progress" | "review" | "done"
export type TaskPriority = "low" | "medium" | "high" | "urgent"
export type TaskType = "task" | "bug" | "feature" | "story" | "epic"

export interface TaskComment {
  id: string
  userId: string
  userName: string
  userAvatar?: string
  content: string
  createdAt: string
}

export interface TaskAttachment {
  id: string
  name: string
  url: string
  type: string
  size: number
  uploadedBy: string
  uploadedAt: string
}

export interface Task {
  id: string
  key: string // e.g., "ERP-123"
  title: string
  description?: string
  type: TaskType
  status: TaskStatus
  priority: TaskPriority
  assigneeId?: string
  assigneeName?: string
  assigneeAvatar?: string
  reporterId: string
  reporterName: string
  labels: string[]
  storyPoints?: number
  dueDate?: string
  createdAt: string
  updatedAt: string
  comments: TaskComment[]
  attachments: TaskAttachment[]
  subtasks?: Task[]
  parentId?: string
  sprintId?: string
}

export interface TaskColumn {
  id: TaskStatus
  title: string
  color: string
  limit?: number // WIP limit
}

export interface Sprint {
  id: string
  name: string
  goal?: string
  startDate: string
  endDate: string
  status: "planning" | "active" | "completed"
}

export interface TeamMember {
  id: string
  name: string
  email: string
  avatar?: string
  role: string
  capacity: number // hours per sprint
}

export interface Project {
  id: string
  key: string
  name: string
  description?: string
  leadId: string
  members: string[]
  createdAt: string
}

export interface TaskBoardConfig {
  columns: TaskColumn[]
  showSubtasks: boolean
  showAssignee: boolean
  showPriority: boolean
  showLabels: boolean
  showDueDate: boolean
  enableDragDrop: boolean
  enableQuickAdd: boolean
}

// Default columns configuration
export const defaultColumns: TaskColumn[] = [
  { id: "backlog", title: "Backlog", color: "bg-slate-500" },
  { id: "todo", title: "To Do", color: "bg-blue-500" },
  { id: "in-progress", title: "In Progress", color: "bg-amber-500" },
  { id: "review", title: "Review", color: "bg-purple-500" },
  { id: "done", title: "Done", color: "bg-green-500" },
]

// Priority configuration
export const priorityConfig: Record<TaskPriority, { label: string; color: string; icon: string }> = {
  low: { label: "Low", color: "text-slate-500", icon: "arrow-down" },
  medium: { label: "Medium", color: "text-blue-500", icon: "minus" },
  high: { label: "High", color: "text-orange-500", icon: "arrow-up" },
  urgent: { label: "Urgent", color: "text-red-500", icon: "alert-triangle" },
}

// Task type configuration
export const taskTypeConfig: Record<TaskType, { label: string; color: string; icon: string }> = {
  task: { label: "Task", color: "bg-blue-500", icon: "check-square" },
  bug: { label: "Bug", color: "bg-red-500", icon: "bug" },
  feature: { label: "Feature", color: "bg-green-500", icon: "zap" },
  story: { label: "Story", color: "bg-purple-500", icon: "book-open" },
  epic: { label: "Epic", color: "bg-violet-500", icon: "layers" },
}

// Sample data
export const sampleTeamMembers: TeamMember[] = [
  { id: "user-1", name: "John Admin", email: "john@erp.com", role: "Project Lead", capacity: 40 },
  { id: "user-2", name: "Sarah Manager", email: "sarah@erp.com", role: "Scrum Master", capacity: 40 },
  { id: "user-3", name: "Mike Sales", email: "mike@erp.com", role: "Developer", capacity: 35 },
  { id: "user-4", name: "Lisa Warehouse", email: "lisa@erp.com", role: "QA Engineer", capacity: 40 },
  { id: "user-5", name: "Tom Viewer", email: "tom@erp.com", role: "Designer", capacity: 30 },
]

export const sampleTasks: Task[] = [
  {
    id: "task-1",
    key: "ERP-101",
    title: "Implement user authentication flow",
    description: "Set up authentication with JWT tokens and refresh token rotation",
    type: "feature",
    status: "done",
    priority: "high",
    assigneeId: "user-3",
    assigneeName: "Mike Sales",
    reporterId: "user-1",
    reporterName: "John Admin",
    labels: ["auth", "security"],
    storyPoints: 8,
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2024-01-20T14:30:00Z",
    comments: [],
    attachments: [],
  },
  {
    id: "task-2",
    key: "ERP-102",
    title: "Fix inventory count discrepancy",
    description: "Stock levels not updating correctly after bulk imports",
    type: "bug",
    status: "in-progress",
    priority: "urgent",
    assigneeId: "user-4",
    assigneeName: "Lisa Warehouse",
    reporterId: "user-2",
    reporterName: "Sarah Manager",
    labels: ["inventory", "critical"],
    storyPoints: 5,
    dueDate: "2024-01-25",
    createdAt: "2024-01-18T09:00:00Z",
    updatedAt: "2024-01-22T11:00:00Z",
    comments: [
      {
        id: "comment-1",
        userId: "user-2",
        userName: "Sarah Manager",
        content: "Please prioritize this - affecting daily operations",
        createdAt: "2024-01-22T11:00:00Z",
      },
    ],
    attachments: [],
  },
  {
    id: "task-3",
    key: "ERP-103",
    title: "Design new dashboard widgets",
    description: "Create mockups for the analytics dashboard redesign",
    type: "task",
    status: "review",
    priority: "medium",
    assigneeId: "user-5",
    assigneeName: "Tom Viewer",
    reporterId: "user-1",
    reporterName: "John Admin",
    labels: ["design", "dashboard"],
    storyPoints: 3,
    createdAt: "2024-01-19T14:00:00Z",
    updatedAt: "2024-01-23T16:00:00Z",
    comments: [],
    attachments: [],
  },
  {
    id: "task-4",
    key: "ERP-104",
    title: "Add export to PDF for reports",
    description: "Allow users to export generated reports as PDF files",
    type: "feature",
    status: "todo",
    priority: "medium",
    assigneeId: "user-3",
    assigneeName: "Mike Sales",
    reporterId: "user-2",
    reporterName: "Sarah Manager",
    labels: ["reports", "export"],
    storyPoints: 5,
    createdAt: "2024-01-20T10:00:00Z",
    updatedAt: "2024-01-20T10:00:00Z",
    comments: [],
    attachments: [],
  },
  {
    id: "task-5",
    key: "ERP-105",
    title: "Optimize database queries",
    description: "Improve performance of slow-running inventory queries",
    type: "task",
    status: "backlog",
    priority: "low",
    reporterId: "user-1",
    reporterName: "John Admin",
    labels: ["performance", "database"],
    storyPoints: 8,
    createdAt: "2024-01-21T09:00:00Z",
    updatedAt: "2024-01-21T09:00:00Z",
    comments: [],
    attachments: [],
  },
  {
    id: "task-6",
    key: "ERP-106",
    title: "Customer portal login issue",
    description: "Some customers unable to login after password reset",
    type: "bug",
    status: "todo",
    priority: "high",
    assigneeId: "user-3",
    assigneeName: "Mike Sales",
    reporterId: "user-4",
    reporterName: "Lisa Warehouse",
    labels: ["auth", "customer"],
    storyPoints: 3,
    dueDate: "2024-01-26",
    createdAt: "2024-01-22T08:00:00Z",
    updatedAt: "2024-01-22T08:00:00Z",
    comments: [],
    attachments: [],
  },
  {
    id: "task-7",
    key: "ERP-107",
    title: "Implement real-time notifications",
    description: "Add WebSocket support for live updates across the platform",
    type: "story",
    status: "in-progress",
    priority: "high",
    assigneeId: "user-3",
    assigneeName: "Mike Sales",
    reporterId: "user-1",
    reporterName: "John Admin",
    labels: ["feature", "real-time"],
    storyPoints: 13,
    createdAt: "2024-01-17T10:00:00Z",
    updatedAt: "2024-01-23T15:00:00Z",
    comments: [],
    attachments: [],
  },
  {
    id: "task-8",
    key: "ERP-108",
    title: "Update documentation",
    description: "Document the new API endpoints and authentication flow",
    type: "task",
    status: "backlog",
    priority: "low",
    reporterId: "user-2",
    reporterName: "Sarah Manager",
    labels: ["documentation"],
    storyPoints: 2,
    createdAt: "2024-01-23T10:00:00Z",
    updatedAt: "2024-01-23T10:00:00Z",
    comments: [],
    attachments: [],
  },
]

export const sampleSprint: Sprint = {
  id: "sprint-1",
  name: "Sprint 23 - January",
  goal: "Complete authentication overhaul and fix critical bugs",
  startDate: "2024-01-15",
  endDate: "2024-01-29",
  status: "active",
}
