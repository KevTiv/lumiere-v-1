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
 * All tables have `organization_id` directly — queries use `WHERE organization_id = X`.
 * Company scope for mutations is resolved inside SpacetimeDB reducers (`company_id` on params).
 */

import { stdbSql, type StdbHttpOptions } from './http'
export type { StdbHttpOptions }
export { stdbSql }

// ── Entity type re-exports for API route handlers ────────────────────────────
// Import from "@lumiere/stdb/server" in route handlers — avoids pulling in
// React/WebSocket dependencies from the main package entry point.
export type {
  // CRM
  Lead, Contact, Opportunity, Activity,
  CreateLeadParams, CreateContactParams, CreateOpportunityParams,
  // Sales
  SaleOrder, SaleOrderLine, ProductPricelist,
  CreateSaleOrderParams, CreateSaleOrderLineParams, CreatePricelistParams,
  // Accounting
  AccountAccount, AccountJournal, AccountMove, AccountTax,
  AccountAnalyticAccount,
  AccountMoveState,
  CreateAccountMoveParams, CreateAccountAccountParams, CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
  MoveType,
  // Inventory
  Product, StockQuant, StockPicking, Warehouse, InventoryAdjustment,
  // Purchasing
  PurchaseOrder, PurchaseOrderLine, PurchaseRequisition,
  CreatePurchaseOrderParams, CreatePurchaseRequisitionParams,
  // Manufacturing
  MrpProduction, MrpBom, MrpWorkorder, MrpWorkcenter,
  CreateMrpProductionParams,
  // HR
  HrEmployee, HrDepartment, HrLeave, HrContract, HrPayslip,
  CreateEmployeeParams,
  EmploymentType,
  // Projects
  ProjectProject, ProjectTask, ProjectTimesheet,
  CreateProjectParams, CreateTaskParams,
  // Documents
  Document, KnowledgeArticle,
  CreateDocumentParams,
  // Helpdesk
  HelpdeskTicket,
  CreateTicketParams,
  TicketPriority,
  // Calendar / Expenses
  CalendarEvent, HrExpense,
  // Settings / Auth
  UserProfile, Role, UserRoleAssignment,
} from './generated/types'

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

// ── Server query functions ───────────────────────────────────────────────────
// All public functions accept organizationId as the tenant scoping value.

// ACCOUNTING

export function serverQueryAccountAccounts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM account_account WHERE organization_id = ${organizationId} ORDER BY code`, opts)
}

export function serverQueryAccountJournals(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM account_journal WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryAccountMoves(
  organizationId: bigint | number,
  moveType?: string,
  opts?: StdbHttpOptions,
) {
  const filter = moveType ? ` AND move_type = '${moveType}'` : ''
  return stdbSql(`SELECT * FROM account_move WHERE organization_id = ${organizationId}${filter}`, opts)
}

export function serverQueryAccountTaxes(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM account_tax WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryBudgets(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM crossovered_budget WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryAnalyticAccounts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM account_analytic_account WHERE organization_id = ${organizationId}`, opts)
}

// SALES

export function serverQuerySaleOrders(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM sale_order WHERE organization_id = ${organizationId}`, opts)
}

export function serverQuerySaleOrderLines(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM sale_order_line WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryPricelists(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM product_pricelist WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryPickingBatches(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM stock_picking_batch WHERE organization_id = ${organizationId}`, opts)
}

// CRM — tables have organization_id directly, no company lookup needed

export function serverQueryLeads(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM lead WHERE organization_id = ${organizationId}`, opts)
}

export async function serverQueryLeadById(
  id: number,
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const rows = await stdbSql<{ id: number }>(
    `SELECT * FROM lead WHERE id = ${id} AND organization_id = ${organizationId} LIMIT 1`,
    opts,
  )
  return rows[0] ?? null
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

export function serverQueryOpportunityStages(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM opp_stage WHERE organization_id = ${organizationId} ORDER BY sequence ASC`,
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

export function serverQueryProjects(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM project_project WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryTasks(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM project_task WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryTimesheets(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM project_timesheet WHERE organization_id = ${organizationId}`, opts)
}

// INVENTORY — products/adjustments have organization_id directly; others via company

export function serverQueryProducts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM product WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryProductCategories(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM product_category WHERE organization_id = ${organizationId} AND deleted_at IS NULL`,
    opts,
  )
}

export function serverQueryUoms(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM uom WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryStockQuants(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM stock_quant WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryStockPickings(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM stock_picking WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryWarehouses(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM warehouse WHERE organization_id = ${organizationId}`, opts)
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

export function serverQueryPurchaseOrders(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM purchase_order WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryPurchaseOrderLines(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM purchase_order_line WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryPurchaseRequisitions(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM purchase_requisition WHERE organization_id = ${organizationId}`, opts)
}

// MANUFACTURING

export function serverQueryMrpProductions(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM mrp_production WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryMrpBoms(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM mrp_bom WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryMrpWorkorders(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM mrp_workorder WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryMrpWorkcenters(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM mrp_workcenter WHERE organization_id = ${organizationId}`, opts)
}

// HR

export function serverQueryEmployees(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM hr_employee WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryDepartments(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM hr_department WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryLeaveRequests(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM hr_leave WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryContracts(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM hr_contract WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryPayslips(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM hr_payslip WHERE organization_id = ${organizationId}`, opts)
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

export function serverQueryHelpdeskTeams(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM helpdesk_team WHERE organization_id = ${organizationId}`,
    opts,
  )
}

export function serverQueryHelpdeskStages(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM helpdesk_stage WHERE organization_id = ${organizationId}`,
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

export function serverQueryFinancialReports(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM financial_report WHERE organization_id = ${organizationId}`, opts)
}

export function serverQueryTrialBalances(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(`SELECT * FROM trial_balance WHERE organization_id = ${organizationId} ORDER BY account_code ASC`, opts)
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

/**
 * Lists all active users in an organization by joining user_organization → user_profile.
 * user_organization already has organization_id directly.
 */
export async function serverQueryOrgUsers(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
) {
  const memberships = await stdbSql<{ userIdentity: string }>(
    `SELECT * FROM user_organization WHERE organization_id = ${organizationId} AND is_active = true`,
    opts,
  )
  if (memberships.length === 0) return []
  const identities = memberships.map((m) => `'${m.userIdentity}'`).join(', ')
  return stdbSql(
    `SELECT * FROM user_profile WHERE identity IN (${identities})`,
    opts,
  )
}
