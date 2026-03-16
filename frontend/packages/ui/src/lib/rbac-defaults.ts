import type { Role, User, PolicyRule, ResourceGroup, SettingsSection, DashboardViewPermission } from "./rbac-types"

// Default system roles
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
      { resource: "module:purchasing", label: "Purchasing", actions: ["read"] },
      { resource: "module:hr", label: "HR & People", actions: ["read"] },
      { resource: "module:manufacturing", label: "Manufacturing", actions: ["read"] },
      { resource: "module:projects", label: "Projects", actions: ["read"] },
      { resource: "module:iot", label: "IoT", actions: ["read"] },
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
    id: "form-config",
    title: "Form Configuration",
    description: "Configure Journal and Forensic Report fields",
    icon: "settings2",
    requiredPermission: "admin:roles",
    requiredAction: "manage"
  },
  {
    id: "audit",
    title: "Audit Log",
    description: "View system activity and security events",
    icon: "scroll",
    requiredPermission: "admin:audit-log",
    requiredAction: "read"
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
