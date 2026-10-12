/** Authenticated tracked imports use the dedicated API; no unpublished SDK is assumed. */
export type TrackedCsvImportScope = {
  companyId?: bigint | number | string
  currencyId?: bigint | number | string
  /** Cache scope for an org-only import that changes company-scoped product reads. */
  cacheCompanyId?: bigint | number | string
}
export type CsvImportRequest = {
  organizationId: string
  entity: string
  requestId: string
  csvData: string
  fileName: string
  companyId?: string
  currencyId?: string
  cacheCompanyId?: string
}

export type CsvImportReceipt = {
  ok: true
  entity: string
  requestId: string
  jobId: string
  status: "pending" | "success" | "partial" | "failed" | "rolled_back"
  totalRows: number
  rowsImported: number
  errorRows: number
  errors: { id: string; jobId: string; rowNumber: number; fieldName?: string | null; errorMessage: string }[]
  errorsRedacted: boolean
}

/** Server-reviewed path aliases with governed entity and import-receipt reads. */
const TRACKED_CSV_IMPORT_ENTITIES = new Set([
  "account",
  "account_account",
  "account_analytic_account",
  "account_move",
  "account_move_line",
  "account_tax",
  "ai_agent",
  "analytic_account",
  "analytics_metric",
  "bom",
  "bom_line",
  "budget",
  "budget_line",
  "company",
  "contact",
  "country",
  "crossovered_budget",
  "crossovered_budget_lines",
  "currency",
  "currency_rate",
  "expense",
  "helpdesk_sla",
  "helpdesk_stage",
  "helpdesk_team",
  "helpdesk_ticket",
  "hr_contract",
  "hr_department",
  "hr_employee",
  "hr_expense",
  "hr_job_position",
  "hr_leave",
  "hr_leave_type",
  "hr_payroll_structure",
  "hr_payslip",
  "hr_resource",
  "hr_salary_rule",
  "knowledge_article",
  "lead",
  "lot",
  "manufacturing_order",
  "mrp_bom",
  "mrp_bom_line",
  "mrp_production",
  "mrp_workcenter",
  "opportunity",
  "product",
  "product_category",
  "product_supplier_info",
  "project",
  "project_project",
  "project_task",
  "project_timesheet",
  "purchase_order",
  "purchase_order_line",
  "report_template",
  "role",
  "sale_order",
  "sale_order_line",
  "stock_location",
  "stock_production_lot",
  "stock_quant",
  "subscription",
  "subscription_plan",
  "supplier_info",
  "task",
  "tax_rate",
  "timesheet",
  "uom",
  "uom_category",
  "warehouse",
  "workcenter",
  "workflow",
])

/** Fail closed when a future entity has not completed server read-policy review. */
export function supportsTrackedCsvImport(entity: string): boolean {
  return TRACKED_CSV_IMPORT_ENTITIES.has(entity)
}

export function createCsvImportRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function decimalId(value: unknown): string {
  const id = String(value ?? "")
  if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 18446744073709551615n ||
    (typeof value === "number" && !Number.isSafeInteger(value))) throw new Error("Invalid import scope or job ID")
  return id
}

export function createCsvImportRequest(
  organizationId: bigint, entity: string, csvData: string, fileName: string,
  scope: TrackedCsvImportScope = {}, requestId = createCsvImportRequestId(),
): CsvImportRequest {
  if (!/^[a-z][a-z0-9_]*$/.test(entity) || !/^[a-f0-9]{32}$/.test(requestId)) throw new Error("Invalid import request")
  return {
    organizationId: decimalId(organizationId), entity, csvData, fileName, requestId,
    companyId: decimalId(scope.companyId),
    ...(scope.currencyId !== undefined ? { currencyId: decimalId(scope.currencyId) } : {}),
    ...(scope.cacheCompanyId !== undefined ? { cacheCompanyId: decimalId(scope.cacheCompanyId) } : {}),
  }
}

export function csvImportRequestPath(request: CsvImportRequest, lookup = false): string {
  const path = `/api/import/${encodeURIComponent(request.entity)}`
  if (!lookup) return path
  const params = new URLSearchParams()
  if (request.companyId) params.set("companyId", request.companyId)
  if (request.currencyId) params.set("currencyId", request.currencyId)
  return `${path}/requests/${request.requestId}${params.size ? `?${params}` : ""}`
}

export function csvImportRequestBody(request: CsvImportRequest): string {
  return JSON.stringify({
    csvData: request.csvData, fileName: request.fileName, requestId: request.requestId,
    params: { companyId: request.companyId, currencyId: request.currencyId },
  })
}

export function parseCsvImportReceipt(value: unknown, request: CsvImportRequest): CsvImportReceipt {
  const row = value as Partial<CsvImportReceipt> | null
  if (!row || row.ok !== true || row.entity !== request.entity || row.requestId !== request.requestId ||
    typeof row.jobId !== "string" || !["pending", "success", "partial", "failed", "rolled_back"].includes(row.status ?? "") ||
    typeof row.errorsRedacted !== "boolean" || !Array.isArray(row.errors)) throw new Error("Import receipt does not match this submission")
  decimalId(row.jobId)
  for (const count of [row.totalRows, row.rowsImported, row.errorRows]) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error("Invalid import receipt counts")
  }
  for (const error of row.errors) {
    if (!error || typeof error.id !== "string" || error.jobId !== row.jobId || !Number.isSafeInteger(error.rowNumber) ||
      error.rowNumber < 0 || typeof error.errorMessage !== "string" ||
      (error.fieldName != null && typeof error.fieldName !== "string")) throw new Error("Invalid job-scoped import error")
    decimalId(error.id)
  }
  return row as CsvImportReceipt
}

/** No fallback to an untracked reducer: an uncertain response must retain its request ID. */
export async function fetchCsvImportReceipt(
  request: CsvImportRequest, fetcher: (path: string, init?: RequestInit) => Promise<Response>, lookup = false,
): Promise<CsvImportReceipt> {
  const response = await fetcher(csvImportRequestPath(request, lookup), lookup ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: csvImportRequestBody(request),
  })
  if (!response.ok) {
    if (response.status === 503) throw new Error("Tracked CSV import is unavailable. The server and contracts must be updated before this file can be imported.")
    if (lookup && response.status === 404) throw new Error("This submission is not visible yet. Retry the same import request to recover its result.")
    const body = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null
    const message = body?.error ?? body?.message
    throw new Error(typeof message === "string" ? message : `Import request failed (${response.status})`)
  }
  return parseCsvImportReceipt(await response.json(), request)
}

const ORG_RESOURCES: Record<string, readonly string[]> = {
  uom_category: ["uoms"], uom: ["uoms"], product_category: ["product-categories", "products"],
  product: ["products"], product_variant: ["products"], warehouse: ["warehouses", "stock-locations"],
  stock_location: ["stock-locations"], stock_quant: ["stock-quants"], stock_production_lot: ["stock-production-lots"],
  hr_resource: ["hr-resources"], hr_department: ["hr-departments"], hr_job_position: ["job-positions"],
  hr_employee: ["hr-employees"], hr_contract: ["hr-contracts"], hr_leave_type: ["hr-leave-types"],
  hr_leave: ["hr-leave-requests"], hr_payroll_structure: ["hr-payroll-structures"], hr_salary_rule: ["hr-salary-rules"], hr_payslip: ["hr-payslips"],
  helpdesk_ticket: ["helpdesk-tickets", "helpdesk-teams", "helpdesk-stages", "helpdesk-slas"],
  helpdesk_team: ["helpdesk-tickets", "helpdesk-teams", "helpdesk-stages", "helpdesk-slas"],
  helpdesk_stage: ["helpdesk-tickets", "helpdesk-teams", "helpdesk-stages", "helpdesk-slas"],
  helpdesk_sla: ["helpdesk-tickets", "helpdesk-teams", "helpdesk-stages", "helpdesk-slas"],
  mrp_production: ["mrp-productions"], mrp_bom: ["mrp-boms", "mrp-bom-lines"],
  mrp_bom_line: ["mrp-boms", "mrp-bom-lines"], mrp_workcenter: ["mrp-workcenters"],
  project_timesheet: ["timesheets", "timesheets-to-validate", "timesheets-unbilled", "project-timesheet-approvals", "project-margin-by-project", "resource-utilisation-by-employee"],
  knowledge_article_category: ["knowledge-articles", "knowledge-categories"], knowledge_article: ["knowledge-articles"],
  hr_expense: ["expenses"], hr_expense_sheet: ["expense-sheets"], report_template: ["report-templates"], analytics_metric: ["analytics-metrics"],
  account_account: ["account-accounts", "account-account-types", "account-groups"], account_move: ["account-moves", "account-move-lines"],
  account_move_line: ["account-moves", "account-move-lines"], account_tax: ["account-taxes", "account-tax-groups"],
  crossovered_budget: ["budgets", "budget-lines", "budget-posts"], crossovered_budget_lines: ["budgets", "budget-lines", "budget-posts"],
  account_analytic_account: ["analytic-accounts", "analytic-lines", "analytic-distribution-models"],
}
const COMPANY_RESOURCES: Record<string, readonly string[]> = {
  sale_order_line: ["sale-order-lines"], purchase_order: ["purchase-orders"], purchase_order_line: ["purchase-order-lines"],
  project_project: ["projects"], product_supplier_info: ["products"],
}

/** Match only affected resources in this submission's scope, including typed stdb query keys. */
export function csvImportInvalidatesQuery(key: readonly unknown[], request: CsvImportRequest): boolean {
  const typed = key[0] === "stdb" || key[0] === "typed-stdb"
  const offset = typed ? 1 : 0
  const resource = String(key[offset] ?? "")
  const scope = String(key[offset + 1] ?? "")
  if (typed && (scope !== request.organizationId || (key[3] === "company" && String(key[4]) !== request.companyId))) return false
  return (ORG_RESOURCES[request.entity]?.includes(resource) === true && scope === request.organizationId) ||
    (COMPANY_RESOURCES[request.entity]?.includes(resource) === true && (typed
      ? scope === request.organizationId
      : scope === (request.cacheCompanyId ?? request.companyId))) ||
    (resource === "import-jobs" && scope === request.organizationId)
}
