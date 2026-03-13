// Journal de Bord Types and Configuration

export type JournalMood = "great" | "good" | "neutral" | "challenging" | "difficult"

export type JournalCategory = 
  | "accomplishment"
  | "challenge"
  | "learning"
  | "collaboration"
  | "goal"
  | "feedback"
  | "idea"
  | "other"

export interface JournalPrompt {
  id: string
  text: string
  category: JournalCategory
  followUp?: string[]
  aiSuggestions?: string[]
}

export interface JournalEntry {
  id: string
  userId: string
  date: string
  mood: JournalMood
  responses: JournalResponse[]
  tags: string[]
  isComplete: boolean
  createdAt: string
  updatedAt: string
}

export interface JournalResponse {
  promptId: string
  prompt: string
  response: string
  category: JournalCategory
  timestamp: string
}

export interface JournalConfig {
  roleId: string
  roleName: string
  dailyPrompts: JournalPrompt[]
  weeklyPrompts?: JournalPrompt[]
  suggestedTags: string[]
  aiAssistEnabled: boolean
  voiceInputEnabled: boolean
}

export interface JournalStats {
  totalEntries: number
  currentStreak: number
  longestStreak: number
  averageMood: number
  topCategories: { category: JournalCategory; count: number }[]
  recentTags: string[]
  completionRate: number
}

// Role-based journal configurations
export const journalConfigs: Record<string, JournalConfig> = {
  "role-admin": {
    roleId: "role-admin",
    roleName: "Administrator",
    suggestedTags: ["system", "security", "team", "planning", "infrastructure"],
    aiAssistEnabled: true,
    voiceInputEnabled: true,
    dailyPrompts: [
      {
        id: "admin-1",
        text: "What system or team decisions did you make today?",
        category: "accomplishment",
        followUp: ["What was the impact?", "Who was involved?"],
        aiSuggestions: ["Approved new user access", "Updated security policies", "Resolved escalated issue"]
      },
      {
        id: "admin-2",
        text: "Were there any security or compliance concerns today?",
        category: "challenge",
        followUp: ["How did you address it?", "What preventive measures are needed?"],
        aiSuggestions: ["No concerns today", "Identified potential vulnerability", "Conducted access review"]
      },
      {
        id: "admin-3",
        text: "What improvements could enhance the team's workflow?",
        category: "idea",
        aiSuggestions: ["Automate routine tasks", "Improve documentation", "Streamline approval process"]
      },
    ]
  },
  "role-manager": {
    roleId: "role-manager",
    roleName: "Manager",
    suggestedTags: ["team", "project", "deadline", "meeting", "performance", "planning"],
    aiAssistEnabled: true,
    voiceInputEnabled: true,
    dailyPrompts: [
      {
        id: "mgr-1",
        text: "What progress did your team make today?",
        category: "accomplishment",
        followUp: ["Any blockers removed?", "Who contributed most?"],
        aiSuggestions: ["Completed sprint goals", "Shipped new feature", "Resolved customer escalation"]
      },
      {
        id: "mgr-2",
        text: "Did you have meaningful 1:1s or team interactions?",
        category: "collaboration",
        followUp: ["What was discussed?", "Any follow-up needed?"],
        aiSuggestions: ["Conducted performance review", "Addressed team concern", "Celebrated team win"]
      },
      {
        id: "mgr-3",
        text: "What challenges is your team facing?",
        category: "challenge",
        aiSuggestions: ["Resource constraints", "Technical debt", "Communication gaps", "Deadline pressure"]
      },
      {
        id: "mgr-4",
        text: "What did you learn about leadership today?",
        category: "learning",
        aiSuggestions: ["Delegation importance", "Active listening", "Conflict resolution"]
      },
    ]
  },
  "role-sales": {
    roleId: "role-sales",
    roleName: "Sales Representative",
    suggestedTags: ["deal", "prospect", "demo", "follow-up", "close", "pipeline", "quota"],
    aiAssistEnabled: true,
    voiceInputEnabled: true,
    dailyPrompts: [
      {
        id: "sales-1",
        text: "How many customer touchpoints did you have today?",
        category: "accomplishment",
        followUp: ["Any promising leads?", "Next steps?"],
        aiSuggestions: ["5 calls, 2 demos", "3 follow-up emails sent", "1 in-person meeting"]
      },
      {
        id: "sales-2",
        text: "Did you move any deals forward in the pipeline?",
        category: "accomplishment",
        followUp: ["Which stage?", "Expected close date?"],
        aiSuggestions: ["Moved 2 deals to negotiation", "Got verbal commitment", "Sent proposal"]
      },
      {
        id: "sales-3",
        text: "What objections did you encounter and how did you handle them?",
        category: "challenge",
        aiSuggestions: ["Price concern - showed ROI", "Timing issue - created urgency", "Competitor comparison"]
      },
      {
        id: "sales-4",
        text: "What's your focus for tomorrow?",
        category: "goal",
        aiSuggestions: ["Close pending deal", "Schedule 3 demos", "Follow up on proposals"]
      },
    ]
  },
  "role-warehouse": {
    roleId: "role-warehouse",
    roleName: "Warehouse Staff",
    suggestedTags: ["inventory", "shipment", "safety", "efficiency", "stock", "quality"],
    aiAssistEnabled: true,
    voiceInputEnabled: true,
    dailyPrompts: [
      {
        id: "wh-1",
        text: "How many orders did you process today?",
        category: "accomplishment",
        followUp: ["Any delays?", "Peak hours?"],
        aiSuggestions: ["Processed 50 orders", "All shipments on time", "Handled rush order"]
      },
      {
        id: "wh-2",
        text: "Were there any inventory discrepancies or issues?",
        category: "challenge",
        followUp: ["How was it resolved?", "Root cause?"],
        aiSuggestions: ["No issues today", "Found miscount in zone B", "Damaged goods reported"]
      },
      {
        id: "wh-3",
        text: "Any safety observations or near-misses?",
        category: "feedback",
        aiSuggestions: ["All clear today", "Spill cleaned promptly", "Equipment maintenance needed"]
      },
      {
        id: "wh-4",
        text: "What could make tomorrow more efficient?",
        category: "idea",
        aiSuggestions: ["Reorganize high-turnover items", "Request additional staff", "Update labeling system"]
      },
    ]
  },
  "role-viewer": {
    roleId: "role-viewer",
    roleName: "Viewer",
    suggestedTags: ["review", "analysis", "report", "insight", "observation"],
    aiAssistEnabled: true,
    voiceInputEnabled: true,
    dailyPrompts: [
      {
        id: "viewer-1",
        text: "What data or reports did you review today?",
        category: "accomplishment",
        aiSuggestions: ["Reviewed sales dashboard", "Analyzed inventory trends", "Checked performance metrics"]
      },
      {
        id: "viewer-2",
        text: "Did you notice any interesting patterns or anomalies?",
        category: "learning",
        aiSuggestions: ["Seasonal trend emerging", "Unusual spike in orders", "Cost variance identified"]
      },
      {
        id: "viewer-3",
        text: "What insights would you share with the team?",
        category: "idea",
        aiSuggestions: ["Opportunity in segment X", "Process improvement needed", "Positive trend to highlight"]
      },
    ]
  },
}

// Default journal config for unknown roles
export const defaultJournalConfig: JournalConfig = {
  roleId: "default",
  roleName: "Team Member",
  suggestedTags: ["work", "progress", "learning", "teamwork"],
  aiAssistEnabled: true,
  voiceInputEnabled: true,
  dailyPrompts: [
    {
      id: "default-1",
      text: "What did you accomplish today?",
      category: "accomplishment",
      aiSuggestions: ["Completed assigned tasks", "Made progress on project", "Helped a colleague"]
    },
    {
      id: "default-2",
      text: "What challenges did you face?",
      category: "challenge",
      aiSuggestions: ["Technical issue", "Time constraint", "Communication gap"]
    },
    {
      id: "default-3",
      text: "What did you learn?",
      category: "learning",
      aiSuggestions: ["New skill", "Process improvement", "Industry insight"]
    },
  ]
}

// Mood options with labels and colors
export const moodOptions: { value: JournalMood; label: string; emoji: string; color: string }[] = [
  { value: "great", label: "Great", emoji: "star", color: "text-green-500" },
  { value: "good", label: "Good", emoji: "smile", color: "text-teal-500" },
  { value: "neutral", label: "Neutral", emoji: "meh", color: "text-yellow-500" },
  { value: "challenging", label: "Challenging", emoji: "frown", color: "text-orange-500" },
  { value: "difficult", label: "Difficult", emoji: "cloud", color: "text-red-500" },
]

// Category labels and icons
export const categoryLabels: Record<JournalCategory, { label: string; icon: string; color: string }> = {
  accomplishment: { label: "Accomplishment", icon: "trophy", color: "text-green-500" },
  challenge: { label: "Challenge", icon: "mountain", color: "text-orange-500" },
  learning: { label: "Learning", icon: "lightbulb", color: "text-yellow-500" },
  collaboration: { label: "Collaboration", icon: "users", color: "text-blue-500" },
  goal: { label: "Goal", icon: "target", color: "text-purple-500" },
  feedback: { label: "Feedback", icon: "message-circle", color: "text-teal-500" },
  idea: { label: "Idea", icon: "sparkles", color: "text-pink-500" },
  other: { label: "Other", icon: "file-text", color: "text-muted-foreground" },
}

// Sample journal entries for demo
export const sampleJournalEntries: JournalEntry[] = [
  {
    id: "entry-1",
    userId: "user-3",
    date: "2024-03-13",
    mood: "great",
    responses: [
      {
        promptId: "sales-1",
        prompt: "How many customer touchpoints did you have today?",
        response: "Had 8 customer calls today, including 2 product demos. One enterprise prospect is very interested.",
        category: "accomplishment",
        timestamp: "2024-03-13T17:30:00Z"
      },
      {
        promptId: "sales-2",
        prompt: "Did you move any deals forward in the pipeline?",
        response: "Moved the Acme Corp deal to final negotiation stage. Expecting to close by end of week.",
        category: "accomplishment",
        timestamp: "2024-03-13T17:32:00Z"
      },
    ],
    tags: ["deal", "demo", "enterprise"],
    isComplete: true,
    createdAt: "2024-03-13T17:30:00Z",
    updatedAt: "2024-03-13T17:35:00Z"
  },
  {
    id: "entry-2",
    userId: "user-3",
    date: "2024-03-12",
    mood: "good",
    responses: [
      {
        promptId: "sales-1",
        prompt: "How many customer touchpoints did you have today?",
        response: "5 calls and 3 email follow-ups. Quiet day but made good progress on proposals.",
        category: "accomplishment",
        timestamp: "2024-03-12T18:00:00Z"
      },
    ],
    tags: ["follow-up", "proposal"],
    isComplete: false,
    createdAt: "2024-03-12T18:00:00Z",
    updatedAt: "2024-03-12T18:05:00Z"
  },
]
