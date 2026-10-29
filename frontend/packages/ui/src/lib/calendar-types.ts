import { i18n as uiI18n } from "@lumiere/i18n"
// Calendar event types for ERP system
export type EventType = "meeting" | "task" | "deadline" | "reminder" | "system" | "shared"
export type ViewMode = "agenda" | "month" | "week" | "day"
export type EventStatus = "scheduled" | "confirmed" | "cancelled" | "completed"

export interface CalendarEvent {
  id: string
  title: string
  description?: string
  startTime: Date
  endTime: Date
  /** An all-day calendar interval; its label omits clock times. */
  allDay?: boolean
  type: EventType
  status: EventStatus
  createdBy: string
  attendees: string[]
  location?: string
  color?: string
  relatedTo?: {
    type: "task" | "invoice" | "order" | "project"
    id: string
  }
  isRecurring?: boolean
  recurringPattern?: "daily" | "weekly" | "monthly" | "yearly"
  reminders?: number[] // minutes before event
  notes?: string
  visibility: "private" | "team" | "public"
}

export interface Calendar {
  id: string
  name: string
  userId: string
  color: string
  isHidden: boolean
  description?: string
}

/** Persisted calendar UI state (not the React `CalendarView` component). */
export interface CalendarViewportState {
  mode: ViewMode
  date: Date
  eventsCount?: number
}

export interface EventCategory {
  type: EventType
  label: string
  color: string
  icon: string
  description: string
}

export interface SharedCalendar {
  calendarId: string
  userId: string
  accessLevel: "view" | "edit"
  sharedBy: string
  sharedAt: Date
}

export interface TeamCalendar {
  id: string
  name: string
  teamId: string
  teamMembers: string[]
  description?: string
}

export const eventTypeConfig: Record<EventType, EventCategory> = {
  meeting: {
    type: "meeting",
    get label() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.meeting.label") },
    color: "bg-info",
    icon: "Users",
    get description() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.teamOrOneOnOneMeetings.description") }
  },
  task: {
    type: "task",
    get label() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.task.label") },
    color: "bg-category-3",
    icon: "CheckCircle",
    get description() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.workTasksAndActivities.description") }
  },
  deadline: {
    type: "deadline",
    get label() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.deadline.label") },
    color: "bg-destructive",
    icon: "AlertCircle",
    get description() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.importantDeadlines.description") }
  },
  reminder: {
    type: "reminder",
    get label() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.reminder.label") },
    color: "bg-warning",
    icon: "Bell",
    get description() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.remindersAndNotifications.description") }
  },
  system: {
    type: "system",
    get label() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.systemEvent.label") },
    color: "bg-success",
    icon: "Zap",
    get description() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.eRPSystemEventsInvoicesOrders.description") }
  },
  shared: {
    type: "shared",
    get label() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.sharedEvent.label") },
    color: "bg-category-1",
    icon: "Share2",
    get description() { return uiI18n.t("calendar.builtIn.calendarTypes.eventTypeConfig.eventsSharedByTeamMembers.description") }
  }
}

// Sample data for demo
export const sampleCalendarEvents: CalendarEvent[] = [
  {
    id: "evt-1",
    title: "Team Standup",
    description: "Daily team sync",
    startTime: new Date(2026, 2, 18, 9, 0),
    endTime: new Date(2026, 2, 18, 9, 30),
    type: "meeting",
    status: "scheduled",
    createdBy: "John Manager",
    attendees: ["john@company.com", "jane@company.com", "bob@company.com"],
    location: "Conference Room A",
    color: "bg-info",
    visibility: "team",
    reminders: [15]
  },
  {
    id: "evt-2",
    title: "Q1 Planning Meeting",
    description: "Quarterly planning and roadmap",
    startTime: new Date(2026, 2, 20, 14, 0),
    endTime: new Date(2026, 2, 20, 15, 30),
    type: "meeting",
    status: "scheduled",
    createdBy: "Sarah Director",
    attendees: ["sarah@company.com", "john@company.com"],
    location: "Main Office",
    color: "bg-info",
    visibility: "team",
    reminders: [30]
  },
  {
    id: "evt-3",
    title: "Invoice Processing Deadline",
    description: "Monthly invoices due",
    startTime: new Date(2026, 2, 25, 17, 0),
    endTime: new Date(2026, 2, 25, 17, 0),
    type: "deadline",
    status: "scheduled",
    createdBy: "System",
    attendees: ["finance@company.com"],
    color: "bg-destructive",
    relatedTo: { type: "invoice", id: "INV-2026-001" },
    visibility: "public",
    reminders: [60, 1440]
  },
  {
    id: "evt-4",
    title: "Client Presentation",
    description: "Q1 Results Presentation",
    startTime: new Date(2026, 2, 22, 10, 0),
    endTime: new Date(2026, 2, 22, 11, 0),
    type: "meeting",
    status: "confirmed",
    createdBy: "Mike Sales",
    attendees: ["mike@company.com", "client@external.com"],
    location: "Virtual - Zoom Link",
    color: "bg-info",
    visibility: "team",
    reminders: [24 * 60, 60]
  },
  {
    id: "evt-5",
    title: "Inventory Reconciliation",
    description: "Monthly stock count",
    startTime: new Date(2026, 2, 21, 8, 0),
    endTime: new Date(2026, 2, 21, 12, 0),
    type: "task",
    status: "scheduled",
    createdBy: "Warehouse Manager",
    attendees: ["warehouse@company.com"],
    color: "bg-category-3",
    relatedTo: { type: "task", id: "TASK-458" },
    visibility: "team",
    reminders: [120]
  },
  {
    id: "evt-6",
    title: "Purchase Order Approved",
    description: "Supplier order PO-2026-082 approved",
    startTime: new Date(2026, 2, 19, 11, 30),
    endTime: new Date(2026, 2, 19, 11, 30),
    type: "system",
    status: "completed",
    createdBy: "System",
    attendees: ["procurement@company.com"],
    color: "bg-success",
    relatedTo: { type: "order", id: "PO-2026-082" },
    visibility: "public"
  }
]

export const sampleCalendars: Calendar[] = [
  {
    id: "cal-1",
    name: "My Calendar",
    userId: "user-1",
    color: "bg-info",
    isHidden: false,
    description: "Personal calendar"
  },
  {
    id: "cal-2",
    name: "Team Calendar",
    userId: "user-1",
    color: "bg-success",
    isHidden: false,
    description: "Shared team events"
  },
  {
    id: "cal-3",
    name: "Company Events",
    userId: "user-1",
    color: "bg-category-3",
    isHidden: false,
    description: "Company-wide events"
  }
]
