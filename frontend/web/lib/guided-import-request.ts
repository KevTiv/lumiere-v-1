import { createCsvImportRequest, supportsTrackedCsvImport } from "@lumiere/query-hooks/hooks/csv-import-request"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"

// UI aliases map to the job tables returned by the existing import API.
const JOB_TABLES: Record<string, string> = {
  account: "account_account", analytic_account: "account_analytic_account", bom: "mrp_bom", bom_line: "mrp_bom_line",
  budget: "crossovered_budget", budget_line: "crossovered_budget_lines", expense: "hr_expense", expense_sheet: "hr_expense_sheet",
  knowledge_category: "knowledge_article_category", lot: "stock_production_lot", manufacturing_order: "mrp_production",
  project: "project_project", supplier_info: "product_supplier_info", task: "project_task", tax_rate: "account_tax",
  timesheet: "project_timesheet", workcenter: "mrp_workcenter",
}
export function trackedImportEntity(entity: string): string { return JOB_TABLES[entity] ?? entity }
export function isExplicitProductPrice(value: string): boolean { return /^\d{1,12}(?:\.\d{1,6})?$/.test(value.trim()) }

export function guidedImportRequest(args: { organizationId: bigint; companyId: number; entity: string; csv: string; fileName: string; companies: readonly { id: unknown; currencyId?: unknown }[] }) {
  const entity = trackedImportEntity(args.entity)
  if (entity === "account_move" || entity === "account_move_line") throw new Error("Use Accounting to import complete journal entries with their lines.")
  if (!supportsTrackedCsvImport(entity)) throw new Error("This import type cannot be submitted from this workspace yet.")
  const company = args.companies.find(row => String(row.id) === String(args.companyId))
  if (!company) throw new Error("The operating company must be loaded before importing.")
  const currencyId = entity === "product" ? String(company.currencyId ?? "") : undefined
  if (currencyId !== undefined && !/^[1-9]\d*$/.test(currencyId)) throw new Error("Configure the operating company’s currency before importing products.")
  if (entity === "product") {
    const parsed = parseCsvText(args.csv)
    const prices = ["sale_price", "cost_price"].map(key => parsed.headers.indexOf(key))
    if (prices.some(index => index < 0) || parsed.rows.some(row => prices.some(index => !isExplicitProductPrice(row[index] ?? "")))) {
      throw new Error("Enter an explicit sale price and cost price for every product. Save unknown prices for review.")
    }
  }
  return createCsvImportRequest(args.organizationId, entity, args.csv, args.fileName, { companyId: args.companyId, ...(currencyId === undefined ? {} : { currencyId }) })
}
