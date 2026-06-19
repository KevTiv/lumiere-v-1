// AI Chat Panel Types - Similar to v0/Zed IDE ACP

export type CitationKind = "live" | "memory" | "activity" | "web"
export type CitationTrust = "authoritative" | "retrieved"

export interface ChatMessageSourceRef {
  /** Citation provenance; omitted = legacy memory embedding hit */
  kind?: CitationKind
  trust?: CitationTrust

  /** RAG / embedding content type or activity entity type */
  content_type?: string
  entity_type?: string
  content_id?: number
  entity_id?: string

  /** Optional field path from a live snapshot */
  field?: string
  /** Human label, e.g. "Sale order #42" */
  label?: string

  score?: number
  excerpt?: string
  /** In-app route when content/entity type maps to an ERP screen */
  href?: string
  /** ISO-8601 UTC when a live row was read from SpacetimeDB */
  snapshot_at?: string
  /** External web citation URL */
  url?: string
  /** ISO-8601 UTC when a web page was fetched */
  fetched_at?: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
  actions?: ChatAction[]
  /** Retrieved memory / RAG citations (assistant messages) */
  sources?: ChatMessageSourceRef[]
  metadata?: {
    model?: string
    tokens?: number
    duration?: number
  }
}

export interface ChatActionDraftPayload {
  draftId: number
  reducerName: string
  summary: string
  paramsJson: Record<string, unknown>
  confidence: number
  warnings: string[]
  elevated: boolean
  status?: "pending" | "approved" | "rejected" | "failed" | "expired"
  executionError?: string | null
  executionRecordId?: number | null
  executionRecordHref?: string
  expiresAt?: string | null
  sourceQuery?: string | null
  companyId?: number
  workflowInstanceId?: number
}

export interface ChatAction {
  id: string
  type: "code" | "file" | "command" | "link" | "draft"
  label: string
  content?: string
  language?: string
  filePath?: string
  onClick?: () => void
  draft?: ChatActionDraftPayload
}

export interface AtCommand {
  id: string
  name: string
  description: string
  icon: string
  category: "data" | "action" | "context" | "help"
  keywords: string[]
  handler?: (args: string) => void
}

export interface ChatContext {
  /** Human-readable view label (typically the module slug). */
  activeView?: string
  route?: string
  module?: string
  activeTab?: string
  companyId?: number
  selectedData?: unknown
  currentUser?: string
  permissions?: string[]
}

export interface AIChatConfig {
  title?: string
  placeholder?: string
  welcomeMessage?: string
  commands: AtCommand[]
  contextProviders?: ContextProvider[]
  maxMessages?: number
  enableHistory?: boolean
  enableFileUpload?: boolean
  onApproveActionDraft?: (draft: ChatActionDraftPayload) => Promise<void>
  onRejectActionDraft?: (draft: ChatActionDraftPayload, reason?: string) => Promise<void>
  onUpdateActionDraft?: (draft: ChatActionDraftPayload) => Promise<void>
}

export interface ContextProvider {
  id: string
  name: string
  icon: string
  getContext: () => Promise<string>
}

// Default @ commands similar to v0/Zed
export const defaultAtCommands: AtCommand[] = [
  // Data commands
  {
    id: "sales",
    name: "sales",
    description: "Query sales data and metrics",
    icon: "trending-up",
    category: "data",
    keywords: ["revenue", "orders", "sales", "metrics"],
  },
  {
    id: "inventory",
    name: "inventory",
    description: "Access inventory and stock levels",
    icon: "package",
    category: "data",
    keywords: ["stock", "products", "warehouse"],
  },
  {
    id: "customers",
    name: "customers",
    description: "Query customer information",
    icon: "users",
    category: "data",
    keywords: ["clients", "users", "accounts"],
  },
  {
    id: "reports",
    name: "reports",
    description: "Generate and access reports",
    icon: "file-text",
    category: "data",
    keywords: ["analytics", "export", "pdf"],
  },
  // Action commands
  {
    id: "create",
    name: "create",
    description: "Create new records or entries",
    icon: "plus-circle",
    category: "action",
    keywords: ["new", "add", "insert"],
  },
  {
    id: "update",
    name: "update",
    description: "Update existing records",
    icon: "edit",
    category: "action",
    keywords: ["modify", "change", "edit"],
  },
  {
    id: "delete",
    name: "delete",
    description: "Delete records (with confirmation)",
    icon: "trash",
    category: "action",
    keywords: ["remove", "destroy"],
  },
  {
    id: "export",
    name: "export",
    description: "Export data to various formats",
    icon: "download",
    category: "action",
    keywords: ["csv", "pdf", "excel"],
  },
  // Context commands
  {
    id: "view",
    name: "view",
    description: "Current dashboard view context",
    icon: "layout",
    category: "context",
    keywords: ["dashboard", "page", "screen"],
  },
  {
    id: "selection",
    name: "selection",
    description: "Currently selected items",
    icon: "check-square",
    category: "context",
    keywords: ["selected", "checked", "highlighted"],
  },
  {
    id: "user",
    name: "user",
    description: "Current user context and permissions",
    icon: "user",
    category: "context",
    keywords: ["me", "profile", "permissions"],
  },
  // Help commands
  {
    id: "help",
    name: "help",
    description: "Get help with commands and features",
    icon: "help-circle",
    category: "help",
    keywords: ["?", "how", "what"],
  },
  {
    id: "docs",
    name: "docs",
    description: "Access documentation",
    icon: "book-open",
    category: "help",
    keywords: ["documentation", "guide", "manual"],
  },
]
