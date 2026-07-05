/**
 * Wizard import targets — mirrors `IMPORT_ENTITIES` in api-server/src/routes/import.rs.
 * `tableName` is the path segment / `import_job.table_name` sent to analyze, preview, and import APIs.
 */
export type ImportEntityGroup =
  | "common"
  | "sales"
  | "purchasing"
  | "inventory"
  | "accounting"
  | "hr"
  | "helpdesk"
  | "manufacturing"
  | "other"

export type ImportEntityOption = {
  /** Unique wizard select value (may differ from tableName for aliases such as vendor). */
  wizardKey: string
  /** SpacetimeDB / api-server `table_name`. */
  tableName: string
  label: string
  group: ImportEntityGroup
  /** Duplicate-detection profile; defaults to tableName when omitted. */
  duplicateKind?: "contact" | "product" | "vendor"
}

export const IMPORT_ENTITY_GROUPS: { key: ImportEntityGroup; label: string }[] = [
  { key: "common", label: "Common" },
  { key: "sales", label: "Sales & CRM" },
  { key: "purchasing", label: "Purchasing" },
  { key: "inventory", label: "Inventory" },
  { key: "accounting", label: "Accounting" },
  { key: "hr", label: "Human resources" },
  { key: "helpdesk", label: "Helpdesk" },
  { key: "manufacturing", label: "Manufacturing" },
  { key: "other", label: "Other" },
]

/** Subset exposed in Settings guided import wizard (≥15 entities, grouped). */
export const WIZARD_IMPORT_ENTITIES: ImportEntityOption[] = [
  // Tier A — common operations
  { wizardKey: "contact", tableName: "contact", label: "Contacts", group: "common", duplicateKind: "contact" },
  { wizardKey: "vendor", tableName: "contact", label: "Vendors (contacts)", group: "common", duplicateKind: "vendor" },
  { wizardKey: "lead", tableName: "lead", label: "Leads", group: "common" },
  { wizardKey: "product", tableName: "product", label: "Products", group: "common", duplicateKind: "product" },
  { wizardKey: "sale_order", tableName: "sale_order", label: "Sale orders", group: "common" },
  { wizardKey: "purchase_order", tableName: "purchase_order", label: "Purchase orders", group: "common" },
  { wizardKey: "opportunity", tableName: "opportunity", label: "Opportunities", group: "common" },
  { wizardKey: "task", tableName: "task", label: "Project tasks", group: "common" },
  { wizardKey: "account", tableName: "account", label: "Accounts", group: "common" },
  { wizardKey: "stock_quant", tableName: "stock_quant", label: "Stock quantities", group: "common" },
  // Sales & CRM
  { wizardKey: "sale_order_line", tableName: "sale_order_line", label: "Sale order lines", group: "sales" },
  { wizardKey: "project", tableName: "project", label: "Projects", group: "sales" },
  { wizardKey: "timesheet", tableName: "timesheet", label: "Timesheets", group: "sales" },
  // Purchasing & inventory
  { wizardKey: "purchase_order_line", tableName: "purchase_order_line", label: "Purchase order lines", group: "purchasing" },
  { wizardKey: "supplier_info", tableName: "supplier_info", label: "Supplier info", group: "purchasing" },
  { wizardKey: "warehouse", tableName: "warehouse", label: "Warehouses", group: "inventory" },
  { wizardKey: "stock_location", tableName: "stock_location", label: "Stock locations", group: "inventory" },
  { wizardKey: "lot", tableName: "lot", label: "Lots / serials", group: "inventory" },
  // Accounting
  { wizardKey: "account_move", tableName: "account_move", label: "Journal entries", group: "accounting" },
  { wizardKey: "tax_rate", tableName: "tax_rate", label: "Tax rates", group: "accounting" },
  { wizardKey: "budget", tableName: "budget", label: "Budgets", group: "accounting" },
  // HR (Tier B)
  { wizardKey: "hr_employee", tableName: "hr_employee", label: "Employees", group: "hr" },
  { wizardKey: "hr_department", tableName: "hr_department", label: "Departments", group: "hr" },
  { wizardKey: "hr_leave", tableName: "hr_leave", label: "Leave requests", group: "hr" },
  { wizardKey: "hr_contract", tableName: "hr_contract", label: "Contracts", group: "hr" },
  { wizardKey: "hr_payslip", tableName: "hr_payslip", label: "Payslips", group: "hr" },
  // Helpdesk (Tier B)
  { wizardKey: "helpdesk_ticket", tableName: "helpdesk_ticket", label: "Tickets", group: "helpdesk" },
  { wizardKey: "helpdesk_team", tableName: "helpdesk_team", label: "Teams", group: "helpdesk" },
  { wizardKey: "helpdesk_stage", tableName: "helpdesk_stage", label: "Stages", group: "helpdesk" },
  // Manufacturing (Tier B)
  { wizardKey: "manufacturing_order", tableName: "manufacturing_order", label: "Manufacturing orders", group: "manufacturing" },
  { wizardKey: "bom", tableName: "bom", label: "Bills of materials", group: "manufacturing" },
  { wizardKey: "workcenter", tableName: "workcenter", label: "Work centers", group: "manufacturing" },
  // Other
  { wizardKey: "expense", tableName: "expense", label: "Expenses", group: "other" },
  { wizardKey: "subscription", tableName: "subscription", label: "Subscriptions", group: "other" },
]

export function wizardEntityByKey(wizardKey: string): ImportEntityOption | undefined {
  return WIZARD_IMPORT_ENTITIES.find((item) => item.wizardKey === wizardKey)
}

export function wizardEntitiesForGroup(group: ImportEntityGroup): ImportEntityOption[] {
  return WIZARD_IMPORT_ENTITIES.filter((item) => item.group === group)
}
