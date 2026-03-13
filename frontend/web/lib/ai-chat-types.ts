// AI Chat Panel Types - Similar to v0/Zed IDE ACP

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
  actions?: ChatAction[]
  metadata?: {
    model?: string
    tokens?: number
    duration?: number
  }
}

export interface ChatAction {
  id: string
  type: "code" | "file" | "command" | "link"
  label: string
  content?: string
  language?: string
  filePath?: string
  onClick?: () => void
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
  activeView?: string
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
