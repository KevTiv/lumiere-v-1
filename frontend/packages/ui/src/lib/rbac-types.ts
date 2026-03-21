// Casbin-style RBAC Types for ERP System

// Resources that can be protected
export type Resource =
  | "dashboard:overview"
  | "dashboard:sales"
  | "dashboard:inventory"
  | "dashboard:customers"
  | "dashboard:analytics"
  | "dashboard:tasks"
  | "dashboard:settings"
  | "module:accounting"
  | "module:sales"
  | "module:crm"
  | "module:inventory"
  | "module:purchasing"
  | "module:hr"
  | "module:manufacturing"
  | "module:projects"
  | "module:iot"
  | "module:documents"
  | "module:proposals"
  | "module:calendar"
  | "module:reports"
  | "module:subscriptions"
  | "module:expenses"
  | "module:helpdesk"
  | "module:workflows"
  | "module:messages"
  | "entries:products"
  | "entries:customers"
  | "entries:orders"
  | "forms:new-order"
  | "forms:new-customer"
  | "forms:generate-report"
  | "tools:notebook"
  | "tools:ai-chat"
  | "admin:users"
  | "admin:roles"
  | "admin:permissions"
  | "admin:audit-log"

// Actions that can be performed
export type Action = "read" | "create" | "update" | "delete" | "manage"

// Effect of a policy rule
export type Effect = "allow" | "deny"

// Casbin-style policy rule: subject, resource, action, effect
export interface PolicyRule {
  id: string
  subject: string // role or user id
  resource: Resource | "*"
  action: Action | "*"
  effect: Effect
  conditions?: Record<string, unknown>
}

// Role definition
export interface Role {
  id: string
  name: string
  description: string
  isSystem?: boolean // system roles cannot be deleted
  color: "blue" | "green" | "orange" | "red" | "purple" | "teal"
  permissions: PolicyRule[]
  createdAt: string
  updatedAt: string
}

// User with role assignments
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  roles: string[] // role ids
  status: "active" | "inactive" | "pending"
  department?: string
  lastLogin?: string
  createdAt: string
  updatedAt: string
}

// Permission check result
export interface PermissionCheckResult {
  allowed: boolean
  rule?: PolicyRule
  reason?: string
}

// Audit log entry
export interface AuditLogEntry {
  id: string
  userId: string
  userName: string
  action: string
  resource: string
  details?: string
  timestamp: string
  ip?: string
}

// Settings section configuration
export interface SettingsSection {
  id: string
  title: string
  description: string
  icon: string
  requiredPermission: Resource
  requiredAction: Action
}

// Dashboard view permission mapping
export interface DashboardViewPermission {
  viewId: string
  resource: Resource
  label: string
}

// Resource group for UI organization
export interface ResourceGroup {
  id: string
  label: string
  resources: {
    resource: Resource
    label: string
    actions: Action[]
  }[]
}

// RBAC Context for the application
export interface RBACContext {
  currentUser: User | null
  roles: Role[]
  policies: PolicyRule[]
  checkPermission: (resource: Resource, action: Action) => PermissionCheckResult
  hasRole: (roleId: string) => boolean
  isAdmin: () => boolean
}

// Settings module configuration
export interface SettingsModuleConfig {
  sections: SettingsSection[]
  adminOnly: boolean
}

// Form field visibility based on permissions
export interface FieldPermission {
  fieldId: string
  visible: boolean
  editable: boolean
  reason?: string
}
