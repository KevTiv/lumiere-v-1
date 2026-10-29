import { i18n as uiI18n } from "@lumiere/i18n"
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
  { key: "common", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.common.label") } },
  { key: "sales", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.sales.label") } },
  { key: "purchasing", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.purchasing.label") } },
  { key: "inventory", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.inventory.label") } },
  { key: "accounting", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.accounting.label") } },
  { key: "hr", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.hr.label") } },
  { key: "helpdesk", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.helpdesk.label") } },
  { key: "manufacturing", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.manufacturing.label") } },
  { key: "other", get label() { return uiI18n.t("settings.builtIn.importEntities.iMPORTENTITYGROUPS.other.label") } },
]

/** Subset exposed in Settings guided import wizard (≥15 entities, grouped). */
export const WIZARD_IMPORT_ENTITIES: ImportEntityOption[] = [
  // Tier A — common operations
  { wizardKey: "contact", tableName: "contact", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.contact.label") }, group: "common", duplicateKind: "contact" },
  { wizardKey: "vendor", tableName: "contact", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.vendor.label") }, group: "common", duplicateKind: "vendor" },
  { wizardKey: "lead", tableName: "lead", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.lead.label") }, group: "common" },
  { wizardKey: "product", tableName: "product", get label() { return uiI18n.t("settings.auditLog.products") }, group: "common", duplicateKind: "product" },
  { wizardKey: "sale_order", tableName: "sale_order", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.saleOrder.label") }, group: "common" },
  { wizardKey: "purchase_order", tableName: "purchase_order", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.purchaseOrder.label") }, group: "common" },
  { wizardKey: "opportunity", tableName: "opportunity", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.opportunity.label") }, group: "common" },
  { wizardKey: "task", tableName: "task", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.task.label") }, group: "common" },
  { wizardKey: "account", tableName: "account", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.account.label") }, group: "common" },
  { wizardKey: "stock_quant", tableName: "stock_quant", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.stockQuant.label") }, group: "common" },
  // Sales & CRM
  { wizardKey: "sale_order_line", tableName: "sale_order_line", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.saleOrderLine.label") }, group: "sales" },
  { wizardKey: "project", tableName: "project", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.project.label") }, group: "sales" },
  { wizardKey: "timesheet", tableName: "timesheet", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.timesheet.label") }, group: "sales" },
  // Purchasing & inventory
  { wizardKey: "purchase_order_line", tableName: "purchase_order_line", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.purchaseOrderLine.label") }, group: "purchasing" },
  { wizardKey: "supplier_info", tableName: "supplier_info", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.supplierInfo.label") }, group: "purchasing" },
  { wizardKey: "warehouse", tableName: "warehouse", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.warehouse.label") }, group: "inventory" },
  { wizardKey: "stock_location", tableName: "stock_location", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.stockLocation.label") }, group: "inventory" },
  { wizardKey: "lot", tableName: "lot", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.lot.label") }, group: "inventory" },
  // Accounting
  { wizardKey: "account_move", tableName: "account_move", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.accountMove.label") }, group: "accounting" },
  { wizardKey: "tax_rate", tableName: "tax_rate", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.taxRate.label") }, group: "accounting" },
  { wizardKey: "budget", tableName: "budget", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.budget.label") }, group: "accounting" },
  // HR (Tier B)
  { wizardKey: "hr_employee", tableName: "hr_employee", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.hrEmployee.label") }, group: "hr" },
  { wizardKey: "hr_department", tableName: "hr_department", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.hrDepartment.label") }, group: "hr" },
  { wizardKey: "hr_leave", tableName: "hr_leave", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.hrLeave.label") }, group: "hr" },
  { wizardKey: "hr_contract", tableName: "hr_contract", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.hrContract.label") }, group: "hr" },
  { wizardKey: "hr_payslip", tableName: "hr_payslip", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.hrPayslip.label") }, group: "hr" },
  // Helpdesk (Tier B)
  { wizardKey: "helpdesk_ticket", tableName: "helpdesk_ticket", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.helpdeskTicket.label") }, group: "helpdesk" },
  { wizardKey: "helpdesk_team", tableName: "helpdesk_team", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.helpdeskTeam.label") }, group: "helpdesk" },
  { wizardKey: "helpdesk_stage", tableName: "helpdesk_stage", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.helpdeskStage.label") }, group: "helpdesk" },
  // Manufacturing (Tier B)
  { wizardKey: "manufacturing_order", tableName: "manufacturing_order", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.manufacturingOrder.label") }, group: "manufacturing" },
  { wizardKey: "bom", tableName: "bom", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.bom.label") }, group: "manufacturing" },
  { wizardKey: "workcenter", tableName: "workcenter", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.workcenter.label") }, group: "manufacturing" },
  // Other
  { wizardKey: "expense", tableName: "expense", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.expense.label") }, group: "other" },
  { wizardKey: "subscription", tableName: "subscription", get label() { return uiI18n.t("settings.builtIn.importEntities.wIZARDIMPORTENTITIES.subscription.label") }, group: "other" },
]

export function wizardEntityByKey(wizardKey: string): ImportEntityOption | undefined {
  return WIZARD_IMPORT_ENTITIES.find((item) => item.wizardKey === wizardKey)
}

export function wizardEntitiesForGroup(group: ImportEntityGroup): ImportEntityOption[] {
  return WIZARD_IMPORT_ENTITIES.filter((item) => item.group === group)
}
