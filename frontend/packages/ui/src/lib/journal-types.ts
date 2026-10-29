import { i18n as uiI18n } from "@lumiere/i18n"
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
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.observation.label") },
    icon: "eye",
    color: "text-info",
    bgColor: "bg-info/10 border-info/20"
  },
  "task-update": {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.taskUpdate.label") },
    icon: "check-circle",
    color: "text-success",
    bgColor: "bg-success/10 border-success/20"
  },
  blocker: {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.blocker.label") },
    icon: "alert-triangle",
    color: "text-destructive",
    bgColor: "bg-destructive/10 border-destructive/20"
  },
  idea: {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.idea.label") },
    icon: "lightbulb",
    color: "text-warning",
    bgColor: "bg-warning/10 border-warning/20"
  },
  "meeting-note": {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.meetingNote.label") },
    icon: "users",
    color: "text-category-3",
    bgColor: "bg-category-3/10 border-category-3/20"
  },
  reminder: {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.reminder.label") },
    icon: "bell",
    color: "text-warning",
    bgColor: "bg-warning/10 border-warning/20"
  },
  question: {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.question.label") },
    icon: "help-circle",
    color: "text-category-7",
    bgColor: "bg-category-7/10 border-category-7/20"
  },
  decision: {
    get label() { return uiI18n.t("journal.builtIn.journalTypes.noteTypeConfig.decision.label") },
    icon: "git-branch",
    color: "text-category-1",
    bgColor: "bg-category-1/10 border-category-1/20"
  },
}

export const notePriorityConfig: Record<NotePriority, { label: string; color: string; dotColor: string }> = {
  low: { get label() { return uiI18n.t("journal.builtIn.journalTypes.notePriorityConfig.low.label") }, color: "text-muted-foreground", dotColor: "bg-muted-foreground" },
  normal: { get label() { return uiI18n.t("journal.builtIn.journalTypes.notePriorityConfig.normal.label") }, color: "text-foreground", dotColor: "bg-foreground" },
  high: { get label() { return uiI18n.t("journal.builtIn.journalTypes.notePriorityConfig.high.label") }, color: "text-warning", dotColor: "bg-warning" },
  urgent: { get label() { return uiI18n.t("journal.builtIn.journalTypes.notePriorityConfig.urgent.label") }, color: "text-destructive", dotColor: "bg-destructive" },
}

export const noteStatusConfig: Record<NoteStatus, { label: string; color: string }> = {
  active: { get label() { return uiI18n.t("common.active") }, color: "text-info" },
  resolved: { get label() { return uiI18n.t("journal.builtIn.journalTypes.noteStatusConfig.resolved.label") }, color: "text-success" },
  archived: { get label() { return uiI18n.t("journal.builtIn.journalTypes.noteStatusConfig.archived.label") }, color: "text-muted-foreground" },
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
      { id: "admin-obs", type: "observation", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.adminObs.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.adminObs.placeholder") }, icon: "eye", color: "text-info", suggestedTags: ["system", "monitoring"] },
      { id: "admin-dec", type: "decision", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.adminDec.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.adminDec.placeholder") }, icon: "git-branch", color: "text-category-1", suggestedTags: ["policy", "security"] },
      { id: "admin-block", type: "blocker", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.adminBlock.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.adminBlock.placeholder") }, icon: "alert-triangle", color: "text-destructive", suggestedTags: ["urgent", "escalation"] },
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
      { id: "mgr-meeting", type: "meeting-note", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.mgrMeeting.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.mgrMeeting.placeholder") }, icon: "users", color: "text-category-3", suggestedTags: ["meeting", "team"] },
      { id: "mgr-update", type: "task-update", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.mgrUpdate.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.mgrUpdate.placeholder") }, icon: "check-circle", color: "text-success", suggestedTags: ["progress", "milestone"] },
      { id: "mgr-decision", type: "decision", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.mgrDecision.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.mgrDecision.placeholder") }, icon: "git-branch", color: "text-category-1", suggestedTags: ["project", "planning"] },
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
      { id: "sales-obs", type: "observation", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.salesObs.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.salesObs.placeholder") }, icon: "eye", color: "text-info", suggestedTags: ["customer", "insight"] },
      { id: "sales-update", type: "task-update", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.salesUpdate.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.salesUpdate.placeholder") }, icon: "check-circle", color: "text-success", suggestedTags: ["deal", "pipeline"] },
      { id: "sales-remind", type: "reminder", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.salesRemind.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.salesRemind.placeholder") }, icon: "bell", color: "text-warning", suggestedTags: ["follow-up", "call"] },
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
      { id: "wh-obs", type: "observation", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.whObs.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.whObs.placeholder") }, icon: "eye", color: "text-info", suggestedTags: ["inventory", "stock"] },
      { id: "wh-block", type: "blocker", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.whBlock.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.whBlock.placeholder") }, icon: "alert-triangle", color: "text-destructive", suggestedTags: ["safety", "equipment"] },
      { id: "wh-update", type: "task-update", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.whUpdate.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.whUpdate.placeholder") }, icon: "check-circle", color: "text-success", suggestedTags: ["shipment", "processing"] },
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
      { id: "view-obs", type: "observation", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.viewObs.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.viewObs.placeholder") }, icon: "eye", color: "text-info", suggestedTags: ["data", "trend"] },
      { id: "view-question", type: "question", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.viewQuestion.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.viewQuestion.placeholder") }, icon: "help-circle", color: "text-category-7", suggestedTags: ["question", "clarify"] },
      { id: "view-idea", type: "idea", get label() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.viewIdea.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.workNotesConfigs.viewIdea.placeholder") }, icon: "lightbulb", color: "text-warning", suggestedTags: ["suggestion", "improvement"] },
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
    { id: "def-obs", type: "observation", get label() { return uiI18n.t("journal.builtIn.journalTypes.defaultWorkNotesConfig.defObs.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.defaultWorkNotesConfig.defObs.placeholder") }, icon: "eye", color: "text-info", suggestedTags: ["observation"] },
    { id: "def-update", type: "task-update", get label() { return uiI18n.t("journal.builtIn.journalTypes.defaultWorkNotesConfig.defUpdate.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.defaultWorkNotesConfig.defUpdate.placeholder") }, icon: "check-circle", color: "text-success", suggestedTags: ["progress"] },
    { id: "def-idea", type: "idea", get label() { return uiI18n.t("journal.builtIn.journalTypes.defaultWorkNotesConfig.defIdea.label") }, get placeholder() { return uiI18n.t("journal.builtIn.journalTypes.defaultWorkNotesConfig.defIdea.placeholder") }, icon: "lightbulb", color: "text-warning", suggestedTags: ["idea"] },
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
