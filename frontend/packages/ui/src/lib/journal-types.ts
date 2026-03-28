// Work Notes / Journal de Bord Types
// A quick-entry system for work observations, notes, and task-related updates

export type NoteType =
  | "observation"    // Something noticed during work
  | "task-update"    // Progress on a task
  | "blocker"        // Something preventing progress
  | "idea"           // Improvement suggestion
  | "meeting-note"   // Quick meeting capture
  | "reminder"       // Self-reminder
  | "question"       // Something to follow up on
  | "decision"       // Decision made or needed

export type NotePriority = "low" | "normal" | "high" | "urgent"

export type NoteStatus = "active" | "resolved" | "archived"

export interface WorkNote {
  id: string
  userId: string
  type: NoteType
  content: string
  priority: NotePriority
  status: NoteStatus
  linkedTaskId?: string
  linkedTaskTitle?: string
  tags: string[]
  mentions: string[]  // @mentioned user IDs
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

export interface QuickNoteTemplate {
  id: string
  type: NoteType
  label: string
  placeholder: string
  icon: string
  color: string
  suggestedTags: string[]
}

export interface WorkNotesConfig {
  roleId: string
  roleName: string
  quickTemplates: QuickNoteTemplate[]
  suggestedTags: string[]
  enableVoiceInput: boolean
  enableTaskLinking: boolean
  defaultPriority: NotePriority
}

// Note type configurations with visual styling
export const noteTypeConfig: Record<NoteType, { label: string; icon: string; color: string; bgColor: string }> = {
  observation: {
    label: "Observation",
    icon: "eye",
    color: "text-info",
    bgColor: "bg-info/10 border-info/20"
  },
  "task-update": {
    label: "Task Update",
    icon: "check-circle",
    color: "text-success",
    bgColor: "bg-success/10 border-success/20"
  },
  blocker: {
    label: "Blocker",
    icon: "alert-triangle",
    color: "text-destructive",
    bgColor: "bg-destructive/10 border-destructive/20"
  },
  idea: {
    label: "Idea",
    icon: "lightbulb",
    color: "text-warning",
    bgColor: "bg-warning/10 border-warning/20"
  },
  "meeting-note": {
    label: "Meeting Note",
    icon: "users",
    color: "text-category-3",
    bgColor: "bg-category-3/10 border-category-3/20"
  },
  reminder: {
    label: "Reminder",
    icon: "bell",
    color: "text-warning",
    bgColor: "bg-warning/10 border-warning/20"
  },
  question: {
    label: "Question",
    icon: "help-circle",
    color: "text-category-7",
    bgColor: "bg-category-7/10 border-category-7/20"
  },
  decision: {
    label: "Decision",
    icon: "git-branch",
    color: "text-category-1",
    bgColor: "bg-category-1/10 border-category-1/20"
  },
}

export const priorityConfig: Record<NotePriority, { label: string; color: string; dotColor: string }> = {
  low: { label: "Low", color: "text-muted-foreground", dotColor: "bg-muted-foreground" },
  normal: { label: "Normal", color: "text-foreground", dotColor: "bg-foreground" },
  high: { label: "High", color: "text-warning", dotColor: "bg-warning" },
  urgent: { label: "Urgent", color: "text-destructive", dotColor: "bg-destructive" },
}

export const statusConfig: Record<NoteStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "text-info" },
  resolved: { label: "Resolved", color: "text-success" },
  archived: { label: "Archived", color: "text-muted-foreground" },
}

// Role-based configurations
export const workNotesConfigs: Record<string, WorkNotesConfig> = {
  "role-admin": {
    roleId: "role-admin",
    roleName: "Administrator",
    suggestedTags: ["system", "security", "policy", "access", "config", "urgent"],
    enableVoiceInput: true,
    enableTaskLinking: true,
    defaultPriority: "normal",
    quickTemplates: [
      { id: "admin-obs", type: "observation", label: "System Observation", placeholder: "Noticed something about the system...", icon: "eye", color: "text-info", suggestedTags: ["system", "monitoring"] },
      { id: "admin-dec", type: "decision", label: "Policy Decision", placeholder: "Decision made regarding...", icon: "git-branch", color: "text-category-1", suggestedTags: ["policy", "security"] },
      { id: "admin-block", type: "blocker", label: "Critical Issue", placeholder: "Blocking issue identified...", icon: "alert-triangle", color: "text-destructive", suggestedTags: ["urgent", "escalation"] },
    ]
  },
  "role-manager": {
    roleId: "role-manager",
    roleName: "Manager",
    suggestedTags: ["team", "project", "deadline", "1on1", "planning", "review"],
    enableVoiceInput: true,
    enableTaskLinking: true,
    defaultPriority: "normal",
    quickTemplates: [
      { id: "mgr-meeting", type: "meeting-note", label: "Meeting Note", placeholder: "Key points from meeting...", icon: "users", color: "text-category-3", suggestedTags: ["meeting", "team"] },
      { id: "mgr-update", type: "task-update", label: "Team Update", placeholder: "Team progress update...", icon: "check-circle", color: "text-success", suggestedTags: ["progress", "milestone"] },
      { id: "mgr-decision", type: "decision", label: "Project Decision", placeholder: "Decided to...", icon: "git-branch", color: "text-category-1", suggestedTags: ["project", "planning"] },
    ]
  },
  "role-sales": {
    roleId: "role-sales",
    roleName: "Sales Rep",
    suggestedTags: ["prospect", "deal", "follow-up", "demo", "pricing", "competitor"],
    enableVoiceInput: true,
    enableTaskLinking: true,
    defaultPriority: "normal",
    quickTemplates: [
      { id: "sales-obs", type: "observation", label: "Customer Insight", placeholder: "Customer mentioned...", icon: "eye", color: "text-info", suggestedTags: ["customer", "insight"] },
      { id: "sales-update", type: "task-update", label: "Deal Update", placeholder: "Deal status changed...", icon: "check-circle", color: "text-success", suggestedTags: ["deal", "pipeline"] },
      { id: "sales-remind", type: "reminder", label: "Follow-up Reminder", placeholder: "Remember to follow up on...", icon: "bell", color: "text-warning", suggestedTags: ["follow-up", "call"] },
    ]
  },
  "role-warehouse": {
    roleId: "role-warehouse",
    roleName: "Warehouse Staff",
    suggestedTags: ["inventory", "shipment", "safety", "equipment", "location", "stock"],
    enableVoiceInput: true,
    enableTaskLinking: true,
    defaultPriority: "normal",
    quickTemplates: [
      { id: "wh-obs", type: "observation", label: "Inventory Note", placeholder: "Noticed in warehouse...", icon: "eye", color: "text-info", suggestedTags: ["inventory", "stock"] },
      { id: "wh-block", type: "blocker", label: "Issue Report", placeholder: "Problem with...", icon: "alert-triangle", color: "text-destructive", suggestedTags: ["safety", "equipment"] },
      { id: "wh-update", type: "task-update", label: "Task Complete", placeholder: "Completed...", icon: "check-circle", color: "text-success", suggestedTags: ["shipment", "processing"] },
    ]
  },
  "role-viewer": {
    roleId: "role-viewer",
    roleName: "Viewer",
    suggestedTags: ["report", "data", "analysis", "question", "insight"],
    enableVoiceInput: true,
    enableTaskLinking: false,
    defaultPriority: "low",
    quickTemplates: [
      { id: "view-obs", type: "observation", label: "Data Observation", placeholder: "Noticed in the data...", icon: "eye", color: "text-info", suggestedTags: ["data", "trend"] },
      { id: "view-question", type: "question", label: "Question", placeholder: "Need clarification on...", icon: "help-circle", color: "text-category-7", suggestedTags: ["question", "clarify"] },
      { id: "view-idea", type: "idea", label: "Suggestion", placeholder: "It would be helpful if...", icon: "lightbulb", color: "text-warning", suggestedTags: ["suggestion", "improvement"] },
    ]
  },
}

export const defaultWorkNotesConfig: WorkNotesConfig = {
  roleId: "default",
  roleName: "Team Member",
  suggestedTags: ["work", "task", "note", "follow-up"],
  enableVoiceInput: true,
  enableTaskLinking: true,
  defaultPriority: "normal",
  quickTemplates: [
    { id: "def-obs", type: "observation", label: "Observation", placeholder: "I noticed...", icon: "eye", color: "text-info", suggestedTags: ["observation"] },
    { id: "def-update", type: "task-update", label: "Task Update", placeholder: "Progress on...", icon: "check-circle", color: "text-success", suggestedTags: ["progress"] },
    { id: "def-idea", type: "idea", label: "Idea", placeholder: "What if we...", icon: "lightbulb", color: "text-warning", suggestedTags: ["idea"] },
  ]
}

// Sample notes for demo
export const sampleWorkNotes: WorkNote[] = [
  {
    id: "note-1",
    userId: "user-3",
    type: "observation",
    content: "Customer ABC Corp asked about bulk pricing during demo. Seems interested in enterprise tier.",
    priority: "high",
    status: "active",
    tags: ["customer", "pricing", "enterprise"],
    mentions: [],
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "note-2",
    userId: "user-3",
    type: "task-update",
    content: "Sent follow-up proposal to XYZ Inc. Waiting for their legal team review.",
    priority: "normal",
    status: "active",
    linkedTaskId: "TASK-123",
    linkedTaskTitle: "Close XYZ Inc Deal",
    tags: ["deal", "proposal", "follow-up"],
    mentions: [],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: "note-3",
    userId: "user-3",
    type: "reminder",
    content: "Call back John from Acme Corp tomorrow at 10am - he's interested in the Q2 promotion.",
    priority: "high",
    status: "active",
    tags: ["call", "follow-up", "promotion"],
    mentions: [],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4 hours ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
  },
  {
    id: "note-4",
    userId: "user-4",
    type: "blocker",
    content: "Forklift in Zone B needs maintenance - hydraulic leak detected. Tagged area as restricted.",
    priority: "urgent",
    status: "resolved",
    tags: ["safety", "equipment", "maintenance"],
    mentions: ["user-2"],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    id: "note-5",
    userId: "user-2",
    type: "meeting-note",
    content: "Weekly sync: Team agreed to prioritize inventory reconciliation this week. Sarah to lead audit of Zone A.",
    priority: "normal",
    status: "active",
    tags: ["meeting", "team", "inventory"],
    mentions: ["user-4"],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
]
