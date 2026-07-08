import type {
  Role,
  User,
  PolicyRule,
  ResourceGroup,
  SettingsSection,
  DashboardViewPermission,
  BackendRoleRow,
  Resource,
  Action,
  Effect,
} from "./rbac-types"

// ── Backend bridge ───────────────────────────────────────────────────────────

export const ADMIN_ROLE_NAMES = ["admin", "owner", "administrator"] as const

export const ROLE_COLORS = ["blue", "green", "orange", "red", "purple", "teal"] as const

const KNOWN_ACTIONS = new Set<Action>([
  "read",
  "create",
  "update",
  "delete",
  "manage",
  "write",
])

function readBool(row: BackendRoleRow, camel: "isSystem" | "isActive"): boolean {
  const snake = camel === "isSystem" ? "is_system" : "is_active"
  const camelVal = row[camel]
  const snakeVal = row[snake as keyof BackendRoleRow]
  if (typeof camelVal === "boolean") return camelVal
  if (typeof snakeVal === "boolean") return snakeVal
  return false
}

function readTimestamp(
  row: BackendRoleRow,
  camel: "createdAt" | "updatedAt",
): string {
  const snake = camel === "createdAt" ? "created_at" : "updated_at"
  const raw = row[camel] ?? row[snake as keyof BackendRoleRow]
  if (typeof raw === "string" && raw.length > 0) return raw
  if (typeof raw === "number") return new Date(raw / 1000).toISOString()
  if (raw && typeof raw === "object" && "microsSinceUnixEpoch" in raw) {
    const micros = Number(raw.microsSinceUnixEpoch)
    if (Number.isFinite(micros)) return new Date(micros / 1000).toISOString()
  }
  return new Date().toISOString()
}

function readMetadataPermissions(row: BackendRoleRow): string[] {
  if (!row.metadata?.trim()) return []
  try {
    const metadata = JSON.parse(row.metadata) as { uiPermissions?: unknown }
    if (!Array.isArray(metadata.uiPermissions)) return []
    return metadata.uiPermissions.map((entry) => String(entry))
  } catch {
    return []
  }
}

/** Parse backend permission strings such as `*:*`, `module:inventory:read`, `admin:roles:update`. */
export function parsePermissionString(
  permission: string,
): { resource: Resource | "*"; action: Action | "*" } | null {
  const trimmed = permission.trim()
  if (!trimmed) return null

  if (trimmed === "*:*") {
    return { resource: "*", action: "*" }
  }

  const colon = trimmed.lastIndexOf(":")
  if (colon <= 0) return null

  const resourcePart = trimmed.slice(0, colon)
  const actionPart = trimmed.slice(colon + 1)

  if (!resourcePart || !actionPart) return null

  const resource: Resource | "*" =
    resourcePart === "*" ? "*" : (resourcePart as Resource)

  const action: Action | "*" =
    actionPart === "*"
      ? "*"
      : KNOWN_ACTIONS.has(actionPart as Action)
        ? (actionPart as Action)
        : (actionPart as Action)

  return { resource, action }
}

export function permissionStringsToPolicyRules(
  roleId: string,
  permissions: readonly string[],
): PolicyRule[] {
  const rules: PolicyRule[] = []

  permissions.forEach((permission, index) => {
    const parsed = parsePermissionString(permission)
    if (!parsed) return

    rules.push({
      id: `${roleId}-perm-${index}`,
      subject: roleId,
      resource: parsed.resource,
      action: parsed.action,
      effect: "allow",
    })
  })

  return rules
}

/** SpacetimeDB `org_permission` row (camelCase or snake_case from BFF). */
export interface BackendOrgPermissionRow {
  id?: number | string
  organizationId?: number
  organization_id?: number
  roleId?: number | null
  role_id?: number | null
  resource?: string
  subject?: unknown
  action?: unknown
  effect?: unknown
}

function readOrgPermissionEnumTag(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "string") return value
  if (typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.tag === "string") return record.tag
  const keys = Object.keys(record)
  if (keys.length === 1) return keys[0] ?? null
  return null
}

function orgPermissionActionToUiAction(action: unknown): Action | "*" {
  const tag = readOrgPermissionEnumTag(action)
  switch (tag) {
    case "Read":
      return "read"
    case "Write":
      return "write"
    case "Create":
      return "create"
    case "Delete":
      return "delete"
    case "All":
      return "*"
    default:
      return "read"
  }
}

function orgPermissionSubjectToPolicySubject(
  subject: unknown,
  roleId: number | null | undefined,
): string | null {
  const tag = readOrgPermissionEnumTag(subject)
  if (tag === "Role") {
    const numeric =
      typeof subject === "object" && subject !== null
        ? (subject as Record<string, unknown>).Role ??
          (subject as Record<string, unknown>).role ??
          roleId
        : roleId
    if (numeric == null || numeric === "") return null
    return String(numeric)
  }
  if (tag === "User") {
    const raw =
      typeof subject === "object" && subject !== null
        ? (subject as Record<string, unknown>).User ??
          (subject as Record<string, unknown>).user
        : null
    if (raw == null) return null
    if (typeof raw === "string") return raw.toLowerCase()
    if (typeof raw === "object" && raw !== null && "toHexString" in raw) {
      return String((raw as { toHexString?: () => string }).toHexString?.() ?? raw)
        .toLowerCase()
    }
    return String(raw).toLowerCase()
  }
  return null
}

export function mapOrgPermissionRowsToPolicyRules(
  rows: readonly BackendOrgPermissionRow[],
): PolicyRule[] {
  const rules: PolicyRule[] = []

  rows.forEach((row, index) => {
    const resource = String(row.resource ?? "").trim()
    if (!resource) return

    const roleId = row.roleId ?? row.role_id ?? null
    const subject = orgPermissionSubjectToPolicySubject(row.subject, roleId)
    if (!subject) return

    const effectTag = readOrgPermissionEnumTag(row.effect)
    const effect: Effect = effectTag === "Deny" ? "deny" : "allow"
    const action = orgPermissionActionToUiAction(row.action)
    const rowId = row.id ?? index

    rules.push({
      id: `org-perm-${rowId}`,
      subject,
      resource: resource as Resource | "*",
      action,
      effect,
    })
  })

  return rules
}

export function mapBackendRoleToRole(row: BackendRoleRow, index = 0): Role | null {
  const id = row.id
  if (id === undefined || id === null || id === "") return null

  const roleId = String(id)
  const permissions = Array.isArray(row.permissions) && row.permissions.length > 0
    ? row.permissions
    : readMetadataPermissions(row)
  const isActive = readBool(row, "isActive")

  return {
    id: roleId,
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    isSystem: readBool(row, "isSystem"),
    isActive,
    color: ROLE_COLORS[index % ROLE_COLORS.length],
    permissions: isActive ? permissionStringsToPolicyRules(roleId, permissions) : [],
    createdAt: readTimestamp(row, "createdAt"),
    updatedAt: readTimestamp(row, "updatedAt"),
  }
}

export function mapBackendRolesToRoles(rows: readonly BackendRoleRow[]): Role[] {
  return rows
    .map((row, index) => mapBackendRoleToRole(row, index))
    .filter((role): role is Role => role != null)
}

export function isAdminRoleName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return (ADMIN_ROLE_NAMES as readonly string[]).includes(normalized)
}

export function roleHasWildcardPermission(role: Role): boolean {
  return role.permissions.some(
    (rule) => rule.effect === "allow" && rule.resource === "*" && rule.action === "*",
  )
}

export function buildRbacUserFromServer(
  roles: readonly Role[],
  serverRoleNames: readonly string[] | undefined,
  serverIdentity: string | undefined,
): User | null {
  if (!serverIdentity || serverIdentity === "unknown") return null

  const names = (serverRoleNames ?? []).map((n) => n.trim().toLowerCase())
  const assignedRoleIds = roles
    .filter((role) => names.includes(role.name.trim().toLowerCase()))
    .map((role) => role.id)

  return {
    id: serverIdentity,
    email: "",
    name: "",
    roles: assignedRoleIds,
    status: "active",
    department: "",
    lastLogin: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Whether a stored rule action satisfies a requested UI action. */
export function actionsMatch(ruleAction: Action | "*", requested: Action): boolean {
  if (ruleAction === "*") return true
  if (ruleAction === requested) return true
  if (ruleAction === "manage") return true
  if (ruleAction === "write" && (requested === "update" || requested === "create")) {
    return true
  }
  if (ruleAction === "update" && requested === "write") return true
  return false
}

/** Whether a stored rule resource satisfies a requested UI resource. */
export function resourcesMatch(ruleResource: Resource | "*", requested: Resource): boolean {
  if (ruleResource === "*") return true
  return ruleResource === requested
}

// ── Default fixtures (dev / storybook) ───────────────────────────────────────
export const defaultRoles: Role[] = [
  {
    id: "role-admin",
    name: "Administrator",
    description: "Full system access with ability to manage users and permissions",
    isSystem: true,
    color: "red",
    permissions: [
      { id: "admin-all", subject: "role-admin", resource: "*", action: "*", effect: "allow" }
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: "role-manager",
    name: "Manager",
    description: "Access to most features except admin settings",
    isSystem: true,
    color: "purple",
    permissions: [
      { id: "mgr-dashboard", subject: "role-manager", resource: "dashboard:overview", action: "read", effect: "allow" },
      { id: "mgr-sales", subject: "role-manager", resource: "dashboard:sales", action: "*", effect: "allow" },
      { id: "mgr-inventory", subject: "role-manager", resource: "dashboard:inventory", action: "*", effect: "allow" },
      { id: "mgr-customers", subject: "role-manager", resource: "dashboard:customers", action: "*", effect: "allow" },
      { id: "mgr-analytics", subject: "role-manager", resource: "dashboard:analytics", action: "read", effect: "allow" },
      { id: "mgr-tasks", subject: "role-manager", resource: "dashboard:tasks", action: "*", effect: "allow" },
      { id: "mgr-products", subject: "role-manager", resource: "entries:products", action: "*", effect: "allow" },
      { id: "mgr-cust-entries", subject: "role-manager", resource: "entries:customers", action: "*", effect: "allow" },
      { id: "mgr-orders", subject: "role-manager", resource: "entries:orders", action: "*", effect: "allow" },
      { id: "mgr-forms", subject: "role-manager", resource: "forms:new-order", action: "*", effect: "allow" },
      { id: "mgr-forms-cust", subject: "role-manager", resource: "forms:new-customer", action: "*", effect: "allow" },
      { id: "mgr-reports", subject: "role-manager", resource: "forms:generate-report", action: "*", effect: "allow" },
      { id: "mgr-mod-accounting", subject: "role-manager", resource: "module:accounting", action: "read", effect: "allow" },
      { id: "mgr-mod-sales", subject: "role-manager", resource: "module:sales", action: "read", effect: "allow" },
      { id: "mgr-mod-crm", subject: "role-manager", resource: "module:crm", action: "read", effect: "allow" },
      { id: "mgr-mod-inventory", subject: "role-manager", resource: "module:inventory", action: "read", effect: "allow" },
      { id: "mgr-mod-purchasing", subject: "role-manager", resource: "module:purchasing", action: "read", effect: "allow" },
      { id: "mgr-mod-hr", subject: "role-manager", resource: "module:hr", action: "read", effect: "allow" },
      { id: "mgr-mod-manufacturing", subject: "role-manager", resource: "module:manufacturing", action: "read", effect: "allow" },
      { id: "mgr-mod-projects", subject: "role-manager", resource: "module:projects", action: "read", effect: "allow" },
      { id: "mgr-mod-iot", subject: "role-manager", resource: "module:iot", action: "read", effect: "allow" },
      { id: "mgr-mod-documents", subject: "role-manager", resource: "module:documents", action: "read", effect: "allow" },
      { id: "mgr-mod-proposals", subject: "role-manager", resource: "module:proposals", action: "read", effect: "allow" },
      { id: "mgr-mod-calendar", subject: "role-manager", resource: "module:calendar", action: "read", effect: "allow" },
      { id: "mgr-mod-reports", subject: "role-manager", resource: "module:reports", action: "read", effect: "allow" },
      { id: "mgr-mod-subscriptions", subject: "role-manager", resource: "module:subscriptions", action: "read", effect: "allow" },
      { id: "mgr-mod-expenses", subject: "role-manager", resource: "module:expenses", action: "read", effect: "allow" },
      { id: "mgr-mod-helpdesk", subject: "role-manager", resource: "module:helpdesk", action: "read", effect: "allow" },
      { id: "mgr-mod-workflows", subject: "role-manager", resource: "module:workflows", action: "read", effect: "allow" },
      { id: "mgr-mod-messages", subject: "role-manager", resource: "module:messages", action: "read", effect: "allow" },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: "role-sales",
    name: "Sales Representative",
    description: "Access to sales and customer management",
    isSystem: false,
    color: "blue",
    permissions: [
      { id: "sales-dashboard", subject: "role-sales", resource: "dashboard:overview", action: "read", effect: "allow" },
      { id: "sales-sales", subject: "role-sales", resource: "dashboard:sales", action: "read", effect: "allow" },
      { id: "sales-customers", subject: "role-sales", resource: "dashboard:customers", action: "read", effect: "allow" },
      { id: "sales-tasks", subject: "role-sales", resource: "dashboard:tasks", action: "*", effect: "allow" },
      { id: "sales-cust-entries", subject: "role-sales", resource: "entries:customers", action: "read", effect: "allow" },
      { id: "sales-cust-create", subject: "role-sales", resource: "entries:customers", action: "create", effect: "allow" },
      { id: "sales-orders", subject: "role-sales", resource: "entries:orders", action: "*", effect: "allow" },
      { id: "sales-new-order", subject: "role-sales", resource: "forms:new-order", action: "*", effect: "allow" },
      { id: "sales-new-cust", subject: "role-sales", resource: "forms:new-customer", action: "*", effect: "allow" },
      { id: "sales-mod-sales", subject: "role-sales", resource: "module:sales", action: "read", effect: "allow" },
      { id: "sales-mod-crm", subject: "role-sales", resource: "module:crm", action: "read", effect: "allow" },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: "role-warehouse",
    name: "Warehouse Staff",
    description: "Access to inventory management only",
    isSystem: false,
    color: "orange",
    permissions: [
      { id: "wh-dashboard", subject: "role-warehouse", resource: "dashboard:overview", action: "read", effect: "allow" },
      { id: "wh-inventory", subject: "role-warehouse", resource: "dashboard:inventory", action: "read", effect: "allow" },
      { id: "wh-products", subject: "role-warehouse", resource: "entries:products", action: "read", effect: "allow" },
      { id: "wh-products-update", subject: "role-warehouse", resource: "entries:products", action: "update", effect: "allow" },
      { id: "wh-tasks", subject: "role-warehouse", resource: "dashboard:tasks", action: "*", effect: "allow" },
      { id: "wh-mod-inventory", subject: "role-warehouse", resource: "module:inventory", action: "read", effect: "allow" },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: "role-viewer",
    name: "Viewer",
    description: "Read-only access to dashboards",
    isSystem: false,
    color: "teal",
    permissions: [
      { id: "viewer-overview", subject: "role-viewer", resource: "dashboard:overview", action: "read", effect: "allow" },
      { id: "viewer-sales", subject: "role-viewer", resource: "dashboard:sales", action: "read", effect: "allow" },
      { id: "viewer-analytics", subject: "role-viewer", resource: "dashboard:analytics", action: "read", effect: "allow" },
      { id: "viewer-tasks", subject: "role-viewer", resource: "dashboard:tasks", action: "read", effect: "allow" },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
]

// Default users
export const defaultUsers: User[] = [
  {
    id: "user-1",
    email: "admin@company.com",
    name: "John Doe",
    roles: ["role-admin"],
    status: "active",
    department: "IT",
    lastLogin: "2024-03-13T10:30:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-03-13T10:30:00Z"
  },
  {
    id: "user-2",
    email: "manager@company.com",
    name: "Jane Smith",
    roles: ["role-manager"],
    status: "active",
    department: "Operations",
    lastLogin: "2024-03-12T14:20:00Z",
    createdAt: "2024-01-15T00:00:00Z",
    updatedAt: "2024-03-12T14:20:00Z"
  },
  {
    id: "user-3",
    email: "sales@company.com",
    name: "Mike Johnson",
    roles: ["role-sales"],
    status: "active",
    department: "Sales",
    lastLogin: "2024-03-13T09:00:00Z",
    createdAt: "2024-02-01T00:00:00Z",
    updatedAt: "2024-03-13T09:00:00Z"
  },
  {
    id: "user-4",
    email: "warehouse@company.com",
    name: "Sarah Wilson",
    roles: ["role-warehouse"],
    status: "active",
    department: "Warehouse",
    lastLogin: "2024-03-11T16:45:00Z",
    createdAt: "2024-02-15T00:00:00Z",
    updatedAt: "2024-03-11T16:45:00Z"
  },
  {
    id: "user-5",
    email: "viewer@company.com",
    name: "Tom Brown",
    roles: ["role-viewer"],
    status: "active",
    department: "Finance",
    lastLogin: "2024-03-10T11:00:00Z",
    createdAt: "2024-03-01T00:00:00Z",
    updatedAt: "2024-03-10T11:00:00Z"
  },
]

// Additional standalone policies
export const defaultPolicies: PolicyRule[] = []

// Resource groups for admin UI
export const resourceGroups: ResourceGroup[] = [
  {
    id: "modules",
    label: "Modules",
    resources: [
      { resource: "module:accounting", label: "Accounting", actions: ["read"] },
      { resource: "module:sales", label: "Sales", actions: ["read"] },
      { resource: "module:crm", label: "CRM", actions: ["read"] },
      { resource: "module:inventory", label: "Inventory", actions: ["read"] },
      { resource: "module:pos", label: "Point of Sale", actions: ["read"] },
      { resource: "module:purchasing", label: "Purchasing", actions: ["read"] },
      { resource: "module:hr", label: "HR & People", actions: ["read"] },
      { resource: "module:manufacturing", label: "Manufacturing", actions: ["read"] },
      { resource: "module:projects", label: "Projects", actions: ["read"] },
      { resource: "module:iot", label: "IoT", actions: ["read"] },
      { resource: "module:map", label: "Map", actions: ["read"] },
      { resource: "module:documents", label: "Documents", actions: ["read"] },
      { resource: "module:proposals", label: "Proposals", actions: ["read"] },
      { resource: "module:calendar", label: "Calendar", actions: ["read"] },
      { resource: "module:reports", label: "Reports", actions: ["read"] },
      { resource: "module:subscriptions", label: "Subscriptions", actions: ["read"] },
      { resource: "module:expenses", label: "Expenses", actions: ["read"] },
      { resource: "module:helpdesk", label: "Helpdesk", actions: ["read"] },
      { resource: "module:workflows", label: "Workflows", actions: ["read"] },
      { resource: "module:messages", label: "Messages", actions: ["read"] },
    ]
  },
  {
    id: "dashboards",
    label: "Dashboards",
    resources: [
      { resource: "dashboard:overview", label: "Overview", actions: ["read"] },
      { resource: "dashboard:sales", label: "Sales", actions: ["read", "create", "update"] },
      { resource: "dashboard:inventory", label: "Inventory", actions: ["read", "create", "update"] },
      { resource: "dashboard:customers", label: "Customers", actions: ["read", "create", "update"] },
      { resource: "dashboard:analytics", label: "Analytics", actions: ["read"] },
      { resource: "dashboard:tasks", label: "Tasks", actions: ["read", "create", "update", "delete"] },
      { resource: "dashboard:settings", label: "Settings", actions: ["read", "manage"] },
    ]
  },
  {
    id: "entries",
    label: "Data Entries",
    resources: [
      { resource: "entries:products", label: "Products", actions: ["read", "create", "update", "delete"] },
      { resource: "entries:customers", label: "Customers", actions: ["read", "create", "update", "delete"] },
      { resource: "entries:orders", label: "Orders", actions: ["read", "create", "update", "delete"] },
    ]
  },
  {
    id: "forms",
    label: "Forms",
    resources: [
      { resource: "forms:new-order", label: "New Order", actions: ["create"] },
      { resource: "forms:new-customer", label: "New Customer", actions: ["create"] },
      { resource: "forms:generate-report", label: "Generate Report", actions: ["create"] },
    ]
  },
  {
    id: "admin",
    label: "Administration",
    resources: [
      { resource: "admin:users", label: "User Management", actions: ["read", "create", "update", "delete"] },
      { resource: "admin:roles", label: "Role Management", actions: ["read", "create", "update", "delete"] },
      { resource: "admin:permissions", label: "Permissions", actions: ["read", "manage"] },
      { resource: "admin:audit-log", label: "Audit Log", actions: ["read"] },
    ]
  },
]

// Settings sections with required permissions
export const settingsSections: SettingsSection[] = [
  {
    id: "profile",
    title: "Profile",
    description: "Manage your personal information and preferences",
    icon: "user",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "notifications",
    title: "Notifications",
    description: "Configure how and when you receive notifications",
    icon: "bell",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Customize the look and feel of your dashboard",
    icon: "palette",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "custom-fields",
    title: "My Custom Fields",
    description: "Add personal tracking fields to your journal",
    icon: "bookmarked",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "users",
    title: "User Management",
    description: "Add, edit, and manage user accounts",
    icon: "users",
    requiredPermission: "admin:users",
    requiredAction: "read"
  },
  {
    id: "roles",
    title: "Roles & Permissions",
    description: "Configure roles and access control policies",
    icon: "shield",
    requiredPermission: "admin:roles",
    requiredAction: "read"
  },
  {
    id: "sso",
    title: "SSO",
    description: "Single sign-on status and WorkOS account linking",
    icon: "keyround",
    requiredPermission: "admin:roles",
    requiredAction: "read"
  },
    {
    id: "form-config",
    title: "Form Configuration",
    description: "Configure Journal and Forensic Report fields",
    icon: "settings2",
    requiredPermission: "admin:roles",
    requiredAction: "update"
  },
  {
    id: "audit",
    title: "Audit Log",
    description: "View system activity and security events",
    icon: "scroll",
    requiredPermission: "admin:audit-log",
    requiredAction: "read"
  },
  {
    id: "organization",
    title: "Organization",
    description: "Manage organization settings and configuration",
    icon: "building",
    requiredPermission: "admin:organization",
    requiredAction: "update"
  },
  {
    id: "ai",
    title: "AI",
    description: "Agents, team personas, insights, and usage spend",
    icon: "sparkles",
    requiredPermission: "admin:organization",
    requiredAction: "update"
  },
]

// Dashboard view to permission mapping
export const dashboardViewPermissions: DashboardViewPermission[] = [
  { viewId: "overview", resource: "dashboard:overview", label: "Overview" },
  { viewId: "sales", resource: "dashboard:sales", label: "Sales" },
  { viewId: "inventory", resource: "dashboard:inventory", label: "Inventory" },
  { viewId: "customers", resource: "dashboard:customers", label: "Customers" },
  { viewId: "analytics", resource: "dashboard:analytics", label: "Analytics" },
  { viewId: "tasks", resource: "dashboard:tasks", label: "Tasks" },
  { viewId: "settings", resource: "dashboard:settings", label: "Settings" },
]
