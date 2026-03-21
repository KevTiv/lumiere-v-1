/**
 * Server-side query functions for Next.js RSC / TanStack Start SSR.
 *
 * These call SpacetimeDB's HTTP SQL API and return plain JSON objects
 * (u64s as numbers, not bigints — safe for JSON serialization/dehydration).
 *
 * Import from "@lumiere/stdb/server" in RSC pages and server actions only.
 * Never import in "use client" components — use the WebSocket hooks instead.
 *
 * ## Scoping model
 * All public query functions accept `organizationId` as the top-level tenant scope.
 * - Tables that have `organization_id` directly use it as a WHERE filter.
 * - Tables that only have `company_id` resolve company IDs via the `company` table
 *   first (two HTTP calls), then filter with `WHERE company_id IN (...)`.
 *
 * This ensures multi-tenant isolation at the organization level regardless of
 * how individual tables are keyed internally.
 */

import { stdbSql, type StdbHttpOptions } from './http'
export type { StdbHttpOptions }

// ── Query key helpers (must match the keys used in client hooks) ─────────────
// All business data keys are scoped by organization_id — the top-level tenant.

// ACCOUNTING
export const accountAccountsKey = (organizationId: bigint | number) =>
  ['account-accounts', String(organizationId)] as const

export const accountJournalsKey = (organizationId: bigint | number) =>
  ['account-journals', String(organizationId)] as const

export const accountMovesKey = (organizationId: bigint | number, moveType = 'all') =>
  ['account-moves', String(organizationId), moveType] as const

export const accountTaxesKey = (organizationId: bigint | number) =>
  ['account-taxes', String(organizationId)] as const

export const budgetsKey = (organizationId: bigint | number) =>
  ['budgets', String(organizationId)] as const

export const analyticAccountsKey = (organizationId: bigint | number) =>
  ['analytic-accounts', String(organizationId)] as const

// SALES
export const saleOrdersKey = (organizationId: bigint | number) =>
  ['sale-orders', String(organizationId)] as const

export const saleOrderLinesKey = (organizationId: bigint | number) =>
  ['sale-order-lines', String(organizationId)] as const

export const pricelistsKey = (organizationId: bigint | number) =>
  ['pricelists', String(organizationId)] as const

export const pickingBatchesKey = (organizationId: bigint | number) =>
  ['picking-batches', String(organizationId)] as const

// CRM
export const leadsKey = (organizationId: bigint | number) =>
  ['leads', String(organizationId)] as const

export const opportunitiesKey = (organizationId: bigint | number) =>
  ['opportunities', String(organizationId)] as const

export const contactsKey = (organizationId: bigint | number) =>
  ['contacts', String(organizationId)] as const

// PROJECTS
export const projectsKey = (organizationId: bigint | number) =>
  ['projects', String(organizationId)] as const

export const tasksKey = (organizationId: bigint | number) =>
  ['tasks', String(organizationId)] as const

export const timesheetsKey = (organizationId: bigint | number) =>
  ['timesheets', String(organizationId)] as const

// INVENTORY
export const productsKey = (organizationId: bigint | number) =>
  ['products', String(organizationId)] as const

export const stockQuantsKey = (organizationId: bigint | number) =>
  ['stock-quants', String(organizationId)] as const

export const stockPickingsKey = (organizationId: bigint | number) =>
  ['stock-pickings', String(organizationId)] as const

export const warehousesKey = (organizationId: bigint | number) =>
  ['warehouses', String(organizationId)] as const

export const inventoryAdjustmentsKey = (organizationId: bigint | number) =>
  ['inventory-adjustments', String(organizationId)] as const

// PURCHASING
export const purchaseOrdersKey = (organizationId: bigint | number) =>
  ['purchase-orders', String(organizationId)] as const

export const purchaseOrderLinesKey = (organizationId: bigint | number) =>
  ['purchase-order-lines', String(organizationId)] as const

export const purchaseRequisitionsKey = (organizationId: bigint | number) =>
  ['purchase-requisitions', String(organizationId)] as const

// MANUFACTURING
export const mrpProductionsKey = (organizationId: bigint | number) =>
  ['mrp-productions', String(organizationId)] as const

export const mrpBomsKey = (organizationId: bigint | number) =>
  ['mrp-boms', String(organizationId)] as const

export const mrpWorkordersKey = (organizationId: bigint | number) =>
  ['mrp-workorders', String(organizationId)] as const

export const mrpWorkcentersKey = (organizationId: bigint | number) =>
  ['mrp-workcenters', String(organizationId)] as const

// HR
export const hrEmployeesKey = (organizationId: bigint | number) =>
  ['hr-employees', String(organizationId)] as const

export const hrDepartmentsKey = (organizationId: bigint | number) =>
  ['hr-departments', String(organizationId)] as const

export const hrLeaveRequestsKey = (organizationId: bigint | number) =>
  ['hr-leave-requests', String(organizationId)] as const

export const hrContractsKey = (organizationId: bigint | number) =>
  ['hr-contracts', String(organizationId)] as const

export const hrPayslipsKey = (organizationId: bigint | number) =>
  ['hr-payslips', String(organizationId)] as const

// AUTH (per-user — scoped by identity to prevent cache cross-contamination)
export const userProfileKey = (identityHex: string) =>
  ['user-profile', identityHex] as const

export const casbinRulesKey = (identityHex: string) =>
  ['casbin-rules', identityHex] as const

export const stdbRolesKey = () =>
  ['stdb-roles'] as const

export const userRoleAssignmentsKey = (identityHex: string) =>
  ['user-role-assignments', identityHex] as const

export const userOrganizationKey = (identityHex: string) =>
  ['user-organization', identityHex] as const

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolves the company IDs that belong to the given organization.
 * Used to translate organization-level scoping into company-level SQL filters
 * for tables that link data via `company_id`.
 */
async function resolveCompanyIds(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
): Promise<number[]> {
  const rows = await stdbSql<{ id: number }>(
    `SELECT id FROM company WHERE organization_id = ${organizationId}`,
    opts,
  )
  return rows.map((r) => Number(r.id))
}

/**
 * Builds a WHERE clause that scopes a table by company_id.
 * Returns null if the org has no companies — callers should return [] immediately.
 */
async function companyWhere(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
): Promise<string | null> {
  const ids = await resolveCompanyIds(organizationId, opts)
  if (ids.length === 0) return null
  return ids.length === 1
    ? `WHERE company_id = ${ids[0]}`
    : `WHERE company_id IN (${ids.join(', ')})`
}

// ── Server query functions ───────────────────────────────────────────────────
// All public functions accept organizationId as the tenant scoping value.
// Tables with organization_id use it directly; tables with company_id use
// companyWhere() to resolve from the company table.

// ACCOUNTING

export async function serverQueryAccountAccounts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM account_account ${where} ORDER BY code`, opts)
}

export async function serverQueryAccountJournals(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM account_journal ${where}`, opts)
}

export async function serverQueryAccountMoves(
  organizationId: bigint | number,
  moveType?: string,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  const filter = moveType ? ` AND move_type = '${moveType}'` : ''
  return stdbSql(`SELECT * FROM account_move ${where}${filter}`, opts)
}

export async function serverQueryAccountTaxes(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM account_tax ${where}`, opts)
}

export async function serverQueryBudgets(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM crossovered_budget ${where}`, opts)
}

export async function serverQueryAnalyticAccounts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM account_analytic_account ${where}`, opts)
}

// SALES

export async function serverQuerySaleOrders(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM sale_order ${where}`, opts)
}

export async function serverQuerySaleOrderLines(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM sale_order_line ${where}`, opts)
}

export async function serverQueryPricelists(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM product_pricelist ${where}`, opts)
}

export async function serverQueryPickingBatches(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM stock_picking_batch ${where}`, opts)
}

// CRM — tables have organization_id directly, no company lookup needed

export function serverQueryLeads(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM lead WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryOpportunities(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM opportunity WHERE organization_id = ${organizationId}`,
    opts,
  )
}

export function serverQueryContacts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM contact WHERE organization_id = ${organizationId}`, opts)
}

// PROJECTS

export async function serverQueryProjects(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM project_project ${where}`, opts)
}

export async function serverQueryTasks(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM project_task ${where}`, opts)
}

export async function serverQueryTimesheets(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM project_timesheet ${where}`, opts)
}

// INVENTORY — products/adjustments have organization_id directly; others via company

export function serverQueryProducts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM product WHERE organization_id = ${organizationId}`, opts)
}

export async function serverQueryStockQuants(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM stock_quant ${where}`, opts)
}

export async function serverQueryStockPickings(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM stock_picking ${where}`, opts)
}

export async function serverQueryWarehouses(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM warehouse ${where}`, opts)
}

export function serverQueryInventoryAdjustments(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM inventory_adjustment WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// PURCHASING

export async function serverQueryPurchaseOrders(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM purchase_order ${where}`, opts)
}

export async function serverQueryPurchaseOrderLines(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM purchase_order_line ${where}`, opts)
}

export async function serverQueryPurchaseRequisitions(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM purchase_requisition ${where}`, opts)
}

// MANUFACTURING

export async function serverQueryMrpProductions(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM mrp_production ${where}`, opts)
}

export async function serverQueryMrpBoms(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM mrp_bom ${where}`, opts)
}

export async function serverQueryMrpWorkorders(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM mrp_workorder ${where}`, opts)
}

export async function serverQueryMrpWorkcenters(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM mrp_workcenter ${where}`, opts)
}

// HR

export async function serverQueryEmployees(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM hr_employee ${where}`, opts)
}

export async function serverQueryDepartments(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM hr_department ${where}`, opts)
}

export async function serverQueryLeaveRequests(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM hr_leave ${where}`, opts)
}

export async function serverQueryContracts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM hr_contract ${where}`, opts)
}

export async function serverQueryPayslips(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM hr_payslip ${where}`, opts)
}

// CALENDAR — organization_id scoped

export function serverQueryCalendarEvents(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM calendar_event WHERE organization_id = ${organizationId} ORDER BY start ASC`,
    opts,
  )
}

// DOCUMENTS — organization_id scoped

export function serverQueryDocuments(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM document WHERE organization_id = ${organizationId}`,
    opts,
  )
}

export function serverQueryKnowledgeArticles(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM knowledge_article WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// EXPENSES — organization_id scoped

export function serverQueryExpenses(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM hr_expense WHERE organization_id = ${organizationId}`,
    opts,
  )
}

export function serverQueryExpenseSheets(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM expense_sheet WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// HELPDESK — organization_id scoped

export function serverQueryHelpdeskTickets(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM helpdesk_ticket WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// MESSAGES — organization_id scoped

export function serverQueryMailMessages(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM mail_message WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// REPORTS — company_id scoped

export async function serverQueryFinancialReports(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM financial_report ${where}`, opts)
}

export async function serverQueryTrialBalances(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const where = await companyWhere(organizationId, opts)
  if (!where) return []
  return stdbSql(`SELECT * FROM trial_balance ${where} ORDER BY account_code ASC`, opts)
}

// SUBSCRIPTIONS — organization_id scoped

export function serverQuerySubscriptions(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM subscription WHERE organization_id = ${organizationId}`,
    opts,
  )
}

export function serverQuerySubscriptionPlans(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM subscription_plan WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// WORKFLOWS — organization_id scoped

export function serverQueryWorkflows(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM workflow WHERE organization_id = ${organizationId}`,
    opts,
  )
}

export function serverQueryWorkflowInstances(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM workflow_instance WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// PROPOSALS — organization_id scoped

export function serverQueryProposals(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM proposal WHERE organization_id = ${organizationId}`,
    opts,
  )
}

// AUTH (per-user — security-critical)

export function serverQueryUserProfile(
  identityHex: string,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM user_profile WHERE identity = '${identityHex}' LIMIT 1`,
    opts,
  )
}

export function serverQueryUserRoleAssignments(
  identityHex: string,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM user_role_assignment WHERE user_identity = '${identityHex}' AND is_active = true`,
    opts,
  )
}

export function serverQueryRoles(opts?: StdbHttpOptions) {
  return stdbSql(`SELECT * FROM role WHERE is_active = true`, opts)
}

/**
 * Fetches casbin_rule rows scoped to the given identity and their role names.
 * Only returns rules where v0 (subject) matches the identity hex directly,
 * or one of the user's assigned role names.
 *
 * This is the server-side enforcement point for "need to know" data access.
 * Future: add Casbin policy evaluation here before fetching business data.
 */
export function serverQueryCasbinRulesForUser(
  identityHex: string,
  roleNames: string[],
  opts?: StdbHttpOptions,
) {
  const subjects = [identityHex, ...roleNames].map((s) => `'${s}'`).join(', ')
  return stdbSql(
    `SELECT * FROM casbin_rule WHERE v0 IN (${subjects})`,
    opts,
  )
}

export function serverQueryUserOrganization(
  identityHex: string,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM user_organization WHERE user_identity = '${identityHex}' AND is_active = true`,
    opts,
  )
}
