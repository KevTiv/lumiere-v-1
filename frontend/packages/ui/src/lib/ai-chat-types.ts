import { i18n as uiI18n } from "@lumiere/i18n"
// AI Chat Panel Types - Similar to v0/Zed IDE ACP

export type CitationKind = "live" | "passage" | "activity" | "web"
export type CitationTrust = "authoritative" | "persisted" | "retrieved"

export interface ChatMessageSourceRef {
  kind: CitationKind
  trust: CitationTrust

  /** Canonical live-entity or persisted-passage identity. */
  entity_type?: string
  entity_id?: string
  source_kind?: string
  source_key?: string
  source_version?: string
  passage_id?: number
  passage_key?: string
  content_hash?: string

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
    runId?: number
    companyId?: number
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
  /** User asserts they're relying on a cited passage as evidence (AIH-13/14). */
  onCiteSource?: (args: { messageId: string; source: ChatMessageSourceRef }) => Promise<void>
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
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.sales.description") },
    icon: "trending-up",
    category: "data",
    keywords: ["revenue", "orders", "sales", "metrics"],
  },
  {
    id: "inventory",
    name: "inventory",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.inventory.description") },
    icon: "package",
    category: "data",
    keywords: ["stock", "products", "warehouse"],
  },
  {
    id: "customers",
    name: "customers",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.customers.description") },
    icon: "users",
    category: "data",
    keywords: ["clients", "users", "accounts"],
  },
  {
    id: "reports",
    name: "reports",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.reports.description") },
    icon: "file-text",
    category: "data",
    keywords: ["analytics", "export", "pdf"],
  },
  // Action commands
  {
    id: "create",
    name: "create",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.create.description") },
    icon: "plus-circle",
    category: "action",
    keywords: ["new", "add", "insert"],
  },
  {
    id: "update",
    name: "update",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.update.description") },
    icon: "edit",
    category: "action",
    keywords: ["modify", "change", "edit"],
  },
  {
    id: "delete",
    name: "delete",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.delete.description") },
    icon: "trash",
    category: "action",
    keywords: ["remove", "destroy"],
  },
  {
    id: "export",
    name: "export",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.export.description") },
    icon: "download",
    category: "action",
    keywords: ["csv", "pdf", "excel"],
  },
  // Context commands
  {
    id: "view",
    name: "view",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.view.description") },
    icon: "layout",
    category: "context",
    keywords: ["dashboard", "page", "screen"],
  },
  {
    id: "selection",
    name: "selection",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.selection.description") },
    icon: "check-square",
    category: "context",
    keywords: ["selected", "checked", "highlighted"],
  },
  {
    id: "user",
    name: "user",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.user.description") },
    icon: "user",
    category: "context",
    keywords: ["me", "profile", "permissions"],
  },
  // Help commands
  {
    id: "help",
    name: "help",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.help.description") },
    icon: "help-circle",
    category: "help",
    keywords: ["?", "how", "what"],
  },
  {
    id: "docs",
    name: "docs",
    get description() { return uiI18n.t("aiAssistant.builtIn.aiChatTypes.defaultAtCommands.docs.description") },
    icon: "book-open",
    category: "help",
    keywords: ["documentation", "guide", "manual"],
  },
]
