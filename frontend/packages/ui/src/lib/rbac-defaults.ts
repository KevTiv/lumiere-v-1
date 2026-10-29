import { i18n as uiI18n } from "@lumiere/i18n"
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
  "admin",
  "approve",
  "post",
  "reconcile",
  "reverse",
  "cancel",
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
  id?: bigint | number | string
  organizationId?: bigint | number
  organization_id?: bigint | number
  roleId?: bigint | number | null
  role_id?: bigint | number | null
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
  roleId: bigint | number | null | undefined,
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
  const permissions = Array.isArray(row.permissions)
    ? row.permissions
    : []
  const isActive = readBool(row, "isActive")
  let color = ROLE_COLORS[index % ROLE_COLORS.length]
  if (row.metadata) {
    try {
      const saved = JSON.parse(row.metadata) as { color?: unknown }
      if (ROLE_COLORS.includes(saved.color as typeof color)) color = saved.color as typeof color
    } catch { /* Invalid display metadata does not affect access. */ }
  }

  return {
    id: roleId,
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    isSystem: readBool(row, "isSystem"),
    isActive,
    color,
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
  serverRoleIds: readonly (number | string)[] | undefined,
  serverIdentity: string | undefined,
): User | null {
  if (!serverIdentity || serverIdentity === "unknown") return null

  const roleIds = new Set((serverRoleIds ?? []).map(String))
  const assignedRoleIds = roles
    .filter((role) => roleIds.has(role.id))
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
  if (String(ruleAction) === 'view') return String(requested) === 'read' || String(requested) === 'view'
  if (ruleAction === 'read' && String(requested) === 'view') return true
  if (ruleAction === "*") return true
  if (ruleAction === requested) return true
  // `admin` is a server-enforced capability. A broad UI `manage` policy must
  // not silently grant it; only an exact or wildcard rule can do that.
  if (ruleAction === "manage" && requested !== "admin") return true
  if (ruleAction === "write" && requested === "update") {
    return true
  }
  if (ruleAction === "update" && requested === "write") return true
  return false
}

/** Whether a stored rule resource satisfies a requested UI resource. */
export function resourcesMatch(ruleResource: Resource | "*", requested: Resource): boolean {
  if (ruleResource === "*") return true
  const canonical = (resource: string) => ({
    'admin:users': 'user_organization', 'admin:roles': 'role',
    'admin:permissions': 'org_permission', 'admin:audit-log': 'audit_log',
    'admin:organization': 'organization',
  }[resource] ?? resource).replace(/-/g, '_')
  return canonical(ruleResource) === canonical(requested)
}

// ── Default fixtures (dev / storybook) ───────────────────────────────────────
export const defaultRoles: Role[] = [
  {
    id: "role-admin",
    name: "Administrator",
    get description() { return uiI18n.t("settings.builtIn.rbacDefaults.defaultRoles.roleAdmin.description") },
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
    get description() { return uiI18n.t("settings.builtIn.rbacDefaults.defaultRoles.roleManager.description") },
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
    get description() { return uiI18n.t("settings.builtIn.rbacDefaults.defaultRoles.roleSales.description") },
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
    get description() { return uiI18n.t("settings.builtIn.rbacDefaults.defaultRoles.roleWarehouse.description") },
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
    get description() { return uiI18n.t("settings.builtIn.rbacDefaults.defaultRoles.roleViewer.description") },
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
    get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.label") },
    resources: [
      { resource: "module:accounting", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelaccounting") }, actions: ["read"] },
      { resource: "module:sales", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelsales") }, actions: ["read"] },
      { resource: "module:crm", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelcRM") }, actions: ["read"] },
      { resource: "module:inventory", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelinventory") }, actions: ["read"] },
      { resource: "module:pos", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelpointOfSale") }, actions: ["read"] },
      { resource: "module:purchasing", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelpurchasing") }, actions: ["read"] },
      { resource: "module:hr", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelhRPeople") }, actions: ["read"] },
      { resource: "module:manufacturing", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelmanufacturing") }, actions: ["read"] },
      { resource: "module:projects", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelprojects") }, actions: ["read"] },
      { resource: "module:iot", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelioT") }, actions: ["read"] },
      { resource: "module:map", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelmap") }, actions: ["read"] },
      { resource: "module:documents", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labeldocuments") }, actions: ["read"] },
      { resource: "module:proposals", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelproposals") }, actions: ["read"] },
      { resource: "module:calendar", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelcalendar") }, actions: ["read"] },
      { resource: "module:reports", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelreports") }, actions: ["read"] },
      { resource: "module:subscriptions", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelsubscriptions") }, actions: ["read"] },
      { resource: "module:expenses", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelexpenses") }, actions: ["read"] },
      { resource: "module:helpdesk", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelhelpdesk") }, actions: ["read"] },
      { resource: "module:workflows", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelworkflows") }, actions: ["read"] },
      { resource: "module:messages", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.modules.labelmessages") }, actions: ["read"] },
    ]
  },
  {
    id: "dashboards",
    get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.label") },
    resources: [
      { resource: "dashboard:overview", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.labeloverview") }, actions: ["read"] },
      { resource: "dashboard:sales", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.labelsales") }, actions: ["read", "create", "update"] },
      { resource: "dashboard:inventory", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.labelinventory") }, actions: ["read", "create", "update"] },
      { resource: "dashboard:customers", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.labelcustomers") }, actions: ["read", "create", "update"] },
      { resource: "dashboard:analytics", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.labelanalytics") }, actions: ["read"] },
      { resource: "dashboard:tasks", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.dashboards.labeltasks") }, actions: ["read", "create", "update", "delete"] },
      { resource: "dashboard:settings", get label() { return uiI18n.t("settings.page.title") }, actions: ["read", "manage"] },
    ]
  },
  {
    id: "entries",
    get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.entries.label") },
    resources: [
      { resource: "entries:products", get label() { return uiI18n.t("settings.auditLog.products") }, actions: ["read", "create", "update", "delete"] },
      { resource: "entries:customers", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.entries.labelcustomers") }, actions: ["read", "create", "update", "delete"] },
      { resource: "entries:orders", get label() { return uiI18n.t("settings.auditLog.orders") }, actions: ["read", "create", "update", "delete"] },
      { resource: "business_history", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.entries.labelbusinessChangeHistory") }, actions: ["read"] },
    ]
  },
  {
    id: "forms",
    get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.forms.label") },
    resources: [
      { resource: "forms:new-order", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.forms.labelnewOrder") }, actions: ["create"] },
      { resource: "forms:new-customer", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.forms.labelnewCustomer") }, actions: ["create"] },
      { resource: "forms:generate-report", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.forms.labelgenerateReport") }, actions: ["create"] },
    ]
  },
  {
    id: "admin",
    get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.admin.label") },
    resources: [
      { resource: "admin:users", get label() { return uiI18n.t("settings.sections.users.title") }, actions: ["read", "create", "update", "delete"] },
      { resource: "admin:roles", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.resourceGroups.admin.labelroleManagement") }, actions: ["read", "create", "update", "delete"] },
      { resource: "admin:permissions", get label() { return uiI18n.t("settings.roles.permissions") }, actions: ["read", "manage"] },
      { resource: "admin:audit-log", get label() { return uiI18n.t("settings.sections.audit.title") }, actions: ["read"] },
    ]
  },
]

// Settings sections with required permissions
export const settingsSections: SettingsSection[] = [
  {
    id: "profile",
    get title() { return uiI18n.t("settings.sections.profile.title") },
    get description() { return uiI18n.t("settings.sections.profile.description") },
    icon: "user",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "notifications",
    get title() { return uiI18n.t("settings.sections.notifications.title") },
    get description() { return uiI18n.t("settings.sections.notifications.description") },
    icon: "bell",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "appearance",
    get title() { return uiI18n.t("settings.sections.appearance.title") },
    get description() { return uiI18n.t("settings.sections.appearance.description") },
    icon: "palette",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "custom-fields",
    get title() { return uiI18n.t("settings.builtIn.rbacDefaults.settingsSections.customFields.title") },
    get description() { return uiI18n.t("settings.sections.custom-fields.description") },
    icon: "bookmarked",
    requiredPermission: "dashboard:settings",
    requiredAction: "read"
  },
  {
    id: "users",
    get title() { return uiI18n.t("settings.sections.users.title") },
    get description() { return uiI18n.t("settings.sections.users.description") },
    icon: "users",
    requiredPermission: "admin:users",
    requiredAction: "read"
  },
  {
    id: "roles",
    get title() { return uiI18n.t("settings.sections.roles.title") },
    get description() { return uiI18n.t("settings.sections.roles.description") },
    icon: "shield",
    requiredPermission: "admin:roles",
    requiredAction: "read"
  },
  {
    id: "sso",
    get title() { return uiI18n.t("settings.sections.sso.title") },
    get description() { return uiI18n.t("settings.sections.sso.description") },
    icon: "keyround",
    requiredPermission: "admin:roles",
    requiredAction: "read"
  },
    {
    id: "form-config",
    get title() { return uiI18n.t("settings.builtIn.rbacDefaults.settingsSections.formConfig.title") },
    get description() { return uiI18n.t("settings.sections.form-config.description") },
    icon: "settings2",
    requiredPermission: "admin:roles",
    requiredAction: "update"
  },
  {
    id: "audit",
    get title() { return uiI18n.t("settings.sections.audit.title") },
    get description() { return uiI18n.t("settings.sections.audit.description") },
    icon: "scroll",
    requiredPermission: "admin:audit-log",
    requiredAction: "read"
  },
  {
    id: "organization",
    get title() { return uiI18n.t("settings.builtIn.rbacDefaults.settingsSections.organization.title") },
    get description() { return uiI18n.t("settings.sections.organization.description") },
    icon: "building",
    requiredPermission: "admin:organization",
    requiredAction: "update"
  },
  {
    id: "ai",
    get title() { return uiI18n.t("settings.builtIn.rbacDefaults.settingsSections.ai.title") },
    get description() { return uiI18n.t("settings.sections.ai.description") },
    icon: "sparkles",
    requiredPermission: "admin:organization",
    requiredAction: "update"
  },
]

export type SettingsSectionExposure = "enabled" | "admin-only" | "hidden"

export interface SettingsSectionExposurePolicy {
  readonly id: string
  readonly exposure: SettingsSectionExposure
  readonly owner: string
  readonly minimumEvidence: string
  readonly hiddenReason: string | null
}

/**
 * Authoritative standard Settings exposure manifest. Every section must be
 * classified exactly once. The finance alpha profile applies its narrower
 * AI-only overlay in `isSettingsSectionVisibleForProfile`.
 */
export const SETTINGS_SECTION_EXPOSURE: readonly SettingsSectionExposurePolicy[] = [
  { id: "profile", exposure: "enabled", owner: "COV-23", minimumEvidence: "authenticated profile settings", hiddenReason: null },
  { id: "notifications", exposure: "enabled", owner: "COV-23", minimumEvidence: "authenticated notification settings", hiddenReason: null },
  { id: "appearance", exposure: "enabled", owner: "UX-02", minimumEvidence: "theme and density persistence", hiddenReason: null },
  { id: "custom-fields", exposure: "enabled", owner: "COV-23", minimumEvidence: "user-owned custom fields", hiddenReason: null },
  { id: "users", exposure: "admin-only", owner: "COV-23", minimumEvidence: "membership assign and revoke", hiddenReason: "organization administrators only" },
  { id: "roles", exposure: "admin-only", owner: "COV-23", minimumEvidence: "role and permission lifecycle", hiddenReason: "organization administrators only" },
  { id: "sso", exposure: "admin-only", owner: "COV-23", minimumEvidence: "SSO status and account-link lifecycle", hiddenReason: "organization administrators only" },
  { id: "form-config", exposure: "admin-only", owner: "COV-22", minimumEvidence: "versioned form publish and stale rejection", hiddenReason: "organization administrators only" },
  { id: "audit", exposure: "admin-only", owner: "COV-23", minimumEvidence: "organization-scoped audit read", hiddenReason: "organization administrators only" },
  { id: "organization", exposure: "admin-only", owner: "COV-23", minimumEvidence: "organization and company lifecycle", hiddenReason: "organization administrators only" },
  { id: "ai", exposure: "hidden", owner: "GOV/CAP", minimumEvidence: "governed AI settings admission", hiddenReason: "AI governance is outside the standard ERP settings surface" },
] as const

const settingsExposureById = new Map(
  SETTINGS_SECTION_EXPOSURE.map((policy) => [policy.id, policy]),
)

export function isSettingsSectionAdmitted(sectionId: string, isAdmin: boolean): boolean {
  const policy = settingsExposureById.get(sectionId)
  if (!policy || policy.exposure === "hidden") return false
  return policy.exposure === "enabled" || isAdmin
}

export function isSettingsSectionVisibleForProfile(
  sectionId: string,
  isAdmin: boolean,
  firstOrgProfile: boolean,
): boolean {
  if (!firstOrgProfile) return isSettingsSectionAdmitted(sectionId, isAdmin)
  return sectionId === "ai" && isAdmin
}

// Dashboard view to permission mapping
export const dashboardViewPermissions: DashboardViewPermission[] = [
  { viewId: "overview", resource: "dashboard:overview", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.dashboardViewPermissions.overview.label") } },
  { viewId: "sales", resource: "dashboard:sales", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.dashboardViewPermissions.sales.label") } },
  { viewId: "inventory", resource: "dashboard:inventory", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.dashboardViewPermissions.inventory.label") } },
  { viewId: "customers", resource: "dashboard:customers", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.dashboardViewPermissions.customers.label") } },
  { viewId: "analytics", resource: "dashboard:analytics", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.dashboardViewPermissions.analytics.label") } },
  { viewId: "tasks", resource: "dashboard:tasks", get label() { return uiI18n.t("settings.builtIn.rbacDefaults.dashboardViewPermissions.tasks.label") } },
  { viewId: "settings", resource: "dashboard:settings", get label() { return uiI18n.t("settings.page.title") } },
]
