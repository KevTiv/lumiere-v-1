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
import {
  type FieldAccessContext,
  resolveReadColumns,
  selectOrgScopedSql,
  selectCompanyScopedSql,
  selectRawSql,
  selectRolesActiveSql,
  selectUserProfileByIdentitySql,
  selectUserRoleAssignmentsForIdentitySql,
  selectUserOrganizationForIdentitySql,
  selectCasbinRulesInSubjectsSql,
} from './field-policy'

export type { StdbHttpOptions }
export { stdbSql }
export type { FieldAccessContext, QueryResourceKey } from './field-policy'
export { loadFieldAccessContext } from './server-field-access'

/** HTTP options plus optional field-level RBAC context (used by `/api/query`). */
export type StdbServerQueryOptions = StdbHttpOptions & {
  fieldAccess?: FieldAccessContext
}

function fq(opts?: StdbServerQueryOptions): FieldAccessContext | undefined {
  return opts?.fieldAccess
}

/** SpacetimeDB HTTP SQL rejects some `ORDER BY` shapes; sort client-side after fetch. */
function sortSqlRows<T extends Record<string, unknown>>(
  rows: T[],
  compare: (a: T, b: T) => number,
): T[] {
  return [...rows].sort(compare)
}

function httpOpts(opts?: StdbServerQueryOptions): StdbHttpOptions | undefined {
  if (!opts) return undefined
  const { fieldAccess: _fa, ...rest } = opts
  return rest as StdbHttpOptions
}

// ── Entity type re-exports for API route handlers ────────────────────────────
// Import from "@lumiere/stdb/server" in route handlers — avoids pulling in
// React/WebSocket dependencies from the main package entry point.
export type {
  // CRM
  Lead, Contact, Opportunity, Activity,
  CreateLeadParams, CreateContactParams, CreateOpportunityParams,
  // Sales
  SaleOrder, SaleOrderLine, ProductPricelist, ProductPricelistItem,
  CreateSaleOrderParams, CreateSaleOrderLineParams, CreatePricelistParams,
  UpdateSaleOrderParams,
  // Accounting
  AccountAccount, AccountJournal, AccountMove, AccountTax,
  AccountAnalyticAccount, AccountBankStatement, AccountAsset,
  AccountMoveState,
  CreateAccountMoveParams, CreateAccountAccountParams, CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
  MoveType,
  // Inventory
  Product, StockQuant, StockPicking, Warehouse, InventoryAdjustment,
  StockLocation, StockProductionLot, QualityCheck, Warehouse3DZone, StockCycleCount,
  PickingWave, WarehouseTask, StockRoute, StockRule, ReplenishmentRule, BarcodeRule,
  StockMove, StockInventory, InventoryValuation,
  // Purchasing
  PurchaseOrder, PurchaseOrderLine, PurchaseRequisition,
  StockLandedCost, SupplierIntakeRequest,
  CreatePurchaseOrderParams, CreatePurchaseRequisitionParams,
  // Manufacturing
  MrpProduction, MrpBom, MrpWorkorder, MrpWorkcenter,
  CreateMrpProductionParams,
  // HR
  HrEmployee, HrDepartment, HrJobPosition, HrLeave, HrContract, HrPayslip,
  HrLeaveType, HrPayrollStructure, HrSalaryRule, HrResource,
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
  // IoT
  IoTDevice, IoTHub, IoTAlert, IoTAction, IoTTelemetry, IoTThreshold,
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

export const pricelistItemsKey = (organizationId: bigint | number) =>
  ['pricelist-items', String(organizationId)] as const

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

export const stockLocationsKey = (organizationId: bigint | number) =>
  ['stock-locations', String(organizationId)] as const

export const stockProductionLotsKey = (organizationId: bigint | number) =>
  ['stock-production-lots', String(organizationId)] as const

export const qualityChecksKey = (organizationId: bigint | number) =>
  ['quality-checks', String(organizationId)] as const

export const warehouse3dZonesKey = (organizationId: bigint | number) =>
  ['warehouse-3d-zones', String(organizationId)] as const

export const stockCycleCountsKey = (organizationId: bigint | number) =>
  ['stock-cycle-counts', String(organizationId)] as const

export const pickingWavesKey = (organizationId: bigint | number) =>
  ['picking-waves', String(organizationId)] as const

export const warehouseTasksKey = (organizationId: bigint | number) =>
  ['warehouse-tasks', String(organizationId)] as const

// PURCHASING
export const purchaseOrdersKey = (organizationId: bigint | number) =>
  ['purchase-orders', String(organizationId)] as const

export const purchaseOrderLinesKey = (organizationId: bigint | number) =>
  ['purchase-order-lines', String(organizationId)] as const

export const purchaseRequisitionsKey = (organizationId: bigint | number) =>
  ['purchase-requisitions', String(organizationId)] as const

export const landedCostsKey = (organizationId: bigint | number) =>
  ['landed-costs', String(organizationId)] as const

export const supplierIntakesKey = (organizationId: bigint | number) =>
  ['supplier-intakes', String(organizationId)] as const

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

export const hrLeaveTypesKey = (organizationId: bigint | number) =>
  ['hr-leave-types', String(organizationId)] as const

export const hrPayrollStructuresKey = (organizationId: bigint | number) =>
  ['hr-payroll-structures', String(organizationId)] as const

export const hrSalaryRulesKey = (organizationId: bigint | number) =>
  ['hr-salary-rules', String(organizationId)] as const

export const hrResourcesKey = (organizationId: bigint | number) =>
  ['hr-resources', String(organizationId)] as const

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
// Pass `fieldAccess` via `StdbServerQueryOptions` from `/api/query` to apply column-level RBAC.

// ACCOUNTING

export function serverQueryAccountAccounts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-accounts',
      'account_account',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY code',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAccountAccountTypes(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-account-types',
      'account_account_type',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY name ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAccountGroups(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-groups',
      'account_group',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY level ASC, name ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAccountJournals(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('account-journals', 'account_journal', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

/** Fiscal years — scoped by `company_id` (matches default company = org id in web). */
export function serverQueryFiscalYears(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectCompanyScopedSql(
      'fiscal-years',
      'account_fiscal_year',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY date_from DESC',
    ),
    httpOpts(opts),
  )
}

/** Accounting periods — scoped by `company_id`. */
export function serverQueryAccountPeriods(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectCompanyScopedSql(
      'account-periods',
      'account_period',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY date_from DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAccountMoves(
  organizationId: bigint | number,
  moveType?: string,
  opts?: StdbServerQueryOptions,
) {
  const filter = moveType ? ` AND move_type = '${moveType}'` : ''
  return stdbSql(
    selectOrgScopedSql('account-moves', 'account_move', organizationId, fq(opts), filter),
    httpOpts(opts),
  )
}

export function serverQueryAccountTaxes(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('account-taxes', 'account_tax', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryAccountPayments(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-payments',
      'account_payment',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryBudgets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('budgets', 'crossovered_budget', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryBudgetLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'budget-lines',
      'crossovered_budget_lines',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY general_budget_id ASC, id ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryBudgetPosts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'budget-posts',
      'budget_post',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY name ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAnalyticAccounts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'analytic-accounts',
      'account_analytic_account',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAnalyticLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'analytic-lines',
      'account_analytic_line',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAnalyticDistributionModels(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'analytic-distribution-models',
      'account_analytic_distribution_model',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryBankStatements(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('bank-statements', 'account_bank_statement', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryBankStatementLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'bank-statement-lines',
      'account_bank_statement_line',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY date DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryBankMatchCandidates(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'bank-match-candidates',
      'bank_match_candidate',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY created_at DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAccountReconciliationWidgets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-reconciliation-widgets',
      'account_reconciliation_widget',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryAccountAssets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('account-assets', 'account_asset', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// CONSOLIDATION (no organization_id — global tables, full scan)

export function serverQueryConsolidationAccounts(
  _organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectRawSql('consolidation-accounts', 'FROM consolidation_account', fq(opts)),
    httpOpts(opts),
  )
}

export function serverQueryConsolidationJournals(
  _organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectRawSql('consolidation-journals', 'FROM consolidation_journal', fq(opts)),
    httpOpts(opts),
  )
}

export function serverQueryConsolidationEliminationEntries(
  _organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectRawSql(
      'consolidation-elimination-entries',
      'FROM consolidation_elimination_entry',
      fq(opts),
    ),
    httpOpts(opts),
  )
}

// SALES

export function serverQuerySaleOrders(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('sale-orders', 'sale_order', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQuerySaleOrderLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('sale-order-lines', 'sale_order_line', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPricelists(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('pricelists', 'product_pricelist', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPricelistItems(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'pricelist-items',
      'product_pricelist_item',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY pricelist_id ASC, sequence ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryPickingBatches(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('picking-batches', 'stock_picking_batch', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// CRM — tables have organization_id directly, no company lookup needed

export function serverQueryLeads(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('leads', 'lead', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export async function serverQueryLeadById(
  id: number,
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const cols = resolveReadColumns('leads', fq(opts))
  const colPart = cols === null ? '*' : cols.join(', ')
  const rows = await stdbSql<{ id: number }>(
    `SELECT ${colPart} FROM lead WHERE id = ${id} AND organization_id = ${organizationId} LIMIT 1`,
    httpOpts(opts),
  )
  return rows[0] ?? null
}

export function serverQueryOpportunities(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('opportunities', 'opportunity', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryOpportunityStages(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'opportunity-stages',
      'opp_stage',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY sequence ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryContacts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('contacts', 'contact', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryActivities(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'activities',
      'activity',
      organizationId,
      fq(opts),
      ' AND deleted_at IS NULL',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

// PROJECTS

export function serverQueryProjects(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('projects', 'project_project', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryTasks(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('tasks', 'project_task', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryTimesheets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('timesheets', 'project_timesheet', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// INVENTORY — products/adjustments have organization_id directly; others via company

export function serverQueryProducts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('products', 'product', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryProductCategories(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'product-categories',
      'product_category',
      organizationId,
      fq(opts),
      ' AND deleted_at IS NULL',
    ),
    httpOpts(opts),
  )
}

export function serverQueryUoms(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('uoms', 'uom', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryStockQuants(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-quants', 'stock_quant', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryStockPickings(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-pickings', 'stock_picking', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryWarehouses(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('warehouses', 'warehouse', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryInventoryAdjustments(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'inventory-adjustments',
      'inventory_adjustment',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryStockLocations(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-locations', 'stock_location', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryStockProductionLots(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'stock-production-lots',
      'stock_production_lot',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryStockProductionSerials(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'stock-production-serials',
      'stock_production_serial',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryQualityChecks(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('quality-checks', 'quality_check', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryWarehouse3dZones(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'warehouse-3d-zones',
      'warehouse_3d_zone',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryStockCycleCounts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'stock-cycle-counts',
      'stock_cycle_count',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryStockInventories(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-inventories', 'stock_inventory', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryStockMoves(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-moves', 'stock_move', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryStockRoutes(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-routes', 'stock_route', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryStockRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('stock-rules', 'stock_rule', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPickingWaves(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('picking-waves', 'picking_wave', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryWarehouseTasks(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('warehouse-tasks', 'warehouse_task', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryReplenishmentRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'replenishment-rules',
      'replenishment_rule',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryBarcodeRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('barcode-rules', 'barcode_rule', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryInventoryValuations(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'inventory-valuations',
      'inventory_valuation',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

// PURCHASING

export function serverQueryPurchaseOrders(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('purchase-orders', 'purchase_order', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPurchaseOrderLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'purchase-order-lines',
      'purchase_order_line',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryPurchaseRequisitions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'purchase-requisitions',
      'purchase_requisition',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryLandedCosts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('landed-costs', 'stock_landed_cost', organizationId, fq(opts), '', ' ORDER BY id DESC'),
    httpOpts(opts),
  )
}

export function serverQuerySupplierIntakes(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'supplier-intakes',
      'supplier_intake_request',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

// MANUFACTURING

export function serverQueryMrpProductions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('mrp-productions', 'mrp_production', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryMrpBoms(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('mrp-boms', 'mrp_bom', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryMrpBomLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'mrp-bom-lines',
      'mrp_bom_line',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY bom_id ASC, sequence ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryMrpWorkorders(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('mrp-workorders', 'mrp_workorder', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryMrpWorkcenters(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('mrp-workcenters', 'mrp_workcenter', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// HR

export function serverQueryEmployees(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('employees', 'hr_employee', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryDepartments(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('departments', 'hr_department', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryJobPositions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('job-positions', 'hr_job_position', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryLeaveRequests(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('leave-requests', 'hr_leave', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryContracts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('contracts', 'hr_contract', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPayslips(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('payslips', 'hr_payslip', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryLeaveTypes(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('leave-types', 'hr_leave_type', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPayrollStructures(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('payroll-structures', 'hr_payroll_structure', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQuerySalaryRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('salary-rules', 'hr_salary_rule', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryHrResources(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('hr-resources', 'hr_resource', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// CALENDAR — organization_id scoped

export function serverQueryCalendarEvents(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'calendar-events',
      'calendar_event',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY start ASC',
    ),
    httpOpts(opts),
  )
}

// DOCUMENTS — organization_id scoped

export function serverQueryDocuments(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('documents', 'document', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryKnowledgeArticles(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'knowledge-articles',
      'knowledge_article',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

// EXPENSES — organization_id scoped

export function serverQueryExpenses(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('expenses', 'hr_expense', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryExpenseSheets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('expense-sheets', 'expense_sheet', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// HELPDESK — organization_id scoped

export function serverQueryHelpdeskTickets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('helpdesk-tickets', 'helpdesk_ticket', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryHelpdeskTeams(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('helpdesk-teams', 'helpdesk_team', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryHelpdeskStages(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('helpdesk-stages', 'helpdesk_stage', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryHelpdeskSlas(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('helpdesk-slas', 'helpdesk_sla', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// MESSAGES — organization_id scoped

export function serverQueryMailMessages(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('mail-messages', 'mail_message', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// REPORTS — organization_id scoped (company_id on row = ERP entity)

export function serverQueryFinancialReports(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('financial-reports', 'financial_report', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => Number(b.id ?? 0) - Number(a.id ?? 0)),
  )
}

export function serverQueryTrialBalances(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('trial-balances', 'trial_balance', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      String(a.accountCode ?? '').localeCompare(String(b.accountCode ?? '')),
    ),
  )
}

export function serverQueryReportTemplates(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('report-templates', 'report_template', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => Number(b.id ?? 0) - Number(a.id ?? 0)),
  )
}

export function serverQueryScheduledReports(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('scheduled-reports', 'scheduled_report', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => {
      const ta = Number(a.nextRun ?? 0)
      const tb = Number(b.nextRun ?? 0)
      return ta - tb
    }),
  )
}

export function serverQueryAnalyticsMetrics(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('analytics-metrics', 'analytics_metric', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => Number(b.id ?? 0) - Number(a.id ?? 0)),
  )
}

// SUBSCRIPTIONS — organization_id scoped

export function serverQuerySubscriptions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('subscriptions', 'subscription', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQuerySubscriptionPlans(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'subscription-plans',
      'subscription_plan',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryDeferredRevenueSchedules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'deferred-revenue-schedules',
      'deferred_revenue_schedule',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryDeferredRevenueLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'deferred-revenue-lines',
      'deferred_revenue_line',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY schedule_id ASC, sequence ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryRevenueRecognitionRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'revenue-recognition-rules',
      'revenue_recognition_rule',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY priority DESC, id DESC',
    ),
    httpOpts(opts),
  )
}

// WORKFLOWS — organization_id scoped

export function serverQueryWorkflows(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('workflows', 'workflow', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryWorkflowInstances(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'workflow-instances',
      'workflow_instance',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryWorkflowActivities(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'workflow-activities',
      'workflow_activity',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY workflow_id ASC, sequence ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryWorkflowTransitions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'workflow-transitions',
      'workflow_transition',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryWorkflowWorkitems(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'workflow-workitems',
      'workflow_workitem',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY instance_id ASC, id ASC',
    ),
    httpOpts(opts),
  )
}

// PROPOSALS — organization_id scoped

export function serverQueryProposals(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposals', 'proposal', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// PROPOSAL CHILD TABLES — organization_id scoped

export function serverQueryProposalSections(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposal-sections', 'proposal_section', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryProposalLineItems(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposal-line-items', 'proposal_line_item', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryProposalVersions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposal-versions', 'proposal_version', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryProposalSourceDocs(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposal-source-docs', 'proposal_source_doc', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryProposalPresence(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposal-presence', 'proposal_presence', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryProposalComments(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('proposal-comments', 'proposal_comment', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// FLEET & POS — organization_id scoped

export function serverQueryFleetVehicles(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('fleet-vehicles', 'fleet_vehicle', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPosTerminals(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('pos-terminals', 'pos_terminal', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

// IOT

export function serverQueryIotDevices(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('iot-devices', 'iot_device', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryIotHubs(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('iot-hubs', 'iot_hub', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryIotAlerts(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('iot-alerts', 'iot_alert', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryIotActions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('iot-actions', 'iot_action', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryIotTelemetry(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('iot-telemetry', 'iot_telemetry', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryIotThresholds(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('iot-thresholds', 'iot_threshold', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

/** AI agent configurations (org-scoped). */
export function serverQueryAiAgents(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('ai-agents', 'ai_agent', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

/** AI team member personas (org-scoped). */
export function serverQueryAiTeamMembers(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('ai-team-members', 'ai_team_member', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

/**
 * AI insights for companies in this organization, plus rows with no company (tenant-wide).
 */
export function serverQueryAiInsights(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const sql = selectRawSql(
    'ai-insights',
    `FROM ai_insight WHERE (
      company_id IN (SELECT id FROM company WHERE organization_id = ${organizationId})
      OR company_id IS NULL
    )`,
    fq(opts),
  )
  return stdbSql(sql, httpOpts(opts))
}

// AUTH (per-user — security-critical)

export function serverQueryUserProfile(
  identityHex: string,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectUserProfileByIdentitySql(identityHex, fq(opts)),
    httpOpts(opts),
  )
}

export function serverQueryUserRoleAssignments(
  identityHex: string,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectUserRoleAssignmentsForIdentitySql(identityHex, fq(opts)),
    httpOpts(opts),
  )
}

export function serverQueryRoles(opts?: StdbServerQueryOptions) {
  return stdbSql(selectRolesActiveSql(fq(opts)), httpOpts(opts))
}

/**
 * Fetches casbin_rule rows where v0 matches the identity hex, role id, or role names.
 */
export function serverQueryCasbinRulesForUser(
  identityHex: string,
  roleSubjects: string[],
  opts?: StdbServerQueryOptions,
) {
  const esc = (s: string) => s.replace(/'/g, "''")
  const subjects = [identityHex, ...roleSubjects].map((s) => `'${esc(s)}'`).join(', ')
  return stdbSql(selectCasbinRulesInSubjectsSql(subjects, fq(opts)), httpOpts(opts))
}

export function serverQueryUserOrganization(
  identityHex: string,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectUserOrganizationForIdentitySql(identityHex, fq(opts)),
    httpOpts(opts),
  )
}

/**
 * Lists all active users in an organization by joining user_organization → user_profile.
 * user_organization already has organization_id directly.
 */
export async function serverQueryOrgUsers(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const colsUo = resolveReadColumns('user-organization', fq(opts))
  const colUo = colsUo === null ? '*' : colsUo.join(', ')
  const memberships = await stdbSql<{ userIdentity: string }>(
    `SELECT ${colUo} FROM user_organization WHERE organization_id = ${organizationId} AND is_active = true`,
    httpOpts(opts),
  )
  if (memberships.length === 0) return []
  // SpacetimeDB HTTP SQL rejects `identity IN (...)` for Identity columns; use `=` + OR (see selectUserProfileByIdentitySql).
  const rawIds = memberships.map((m) => String(m.userIdentity))
  const uniqueIds = [...new Set(rawIds)]
  const esc = (s: string) => s.replace(/'/g, "''")
  const colsP = resolveReadColumns('user-profile', fq(opts))
  const colP = colsP === null ? '*' : colsP.join(', ')
  const whereIdentity =
    uniqueIds.length === 1
      ? `identity = '${esc(uniqueIds[0])}'`
      : `(${uniqueIds.map((id) => `identity = '${esc(id)}'`).join(' OR ')})`
  const sqlProfile = `SELECT ${colP} FROM user_profile WHERE ${whereIdentity}`
  // #region agent log
  fetch('http://127.0.0.1:7671/ingest/07aebab7-6f69-4cbc-af66-6d5a65969c9c', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f240c9' },
    body: JSON.stringify({
      sessionId: 'f240c9',
      location: 'server.ts:serverQueryOrgUsers',
      message: 'org users: profile query built',
      data: {
        organizationId: String(organizationId),
        membershipCount: memberships.length,
        uniqueIdentityCount: uniqueIds.length,
        identityPredicate: uniqueIds.length === 1 ? 'EQ' : 'OR_EQ',
        colPWildcard: colP === '*',
        sqlPreviewLen: sqlProfile.length,
        sqlHead: sqlProfile.slice(0, 140),
      },
      timestamp: Date.now(),
      runId: 'post-fix',
      hypothesisId: 'A',
    }),
  }).catch(() => {})
  // #endregion
  const rows = await stdbSql(sqlProfile, httpOpts(opts))
  // #region agent log
  fetch('http://127.0.0.1:7671/ingest/07aebab7-6f69-4cbc-af66-6d5a65969c9c', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f240c9' },
    body: JSON.stringify({
      sessionId: 'f240c9',
      location: 'server.ts:serverQueryOrgUsers',
      message: 'org users: profile query ok',
      data: { rowCount: rows.length },
      timestamp: Date.now(),
      runId: 'post-fix',
      hypothesisId: 'A',
    }),
  }).catch(() => {})
  // #endregion
  return rows
}
