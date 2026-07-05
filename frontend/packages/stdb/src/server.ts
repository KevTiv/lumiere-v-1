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
  resolveHttpSqlColumns,
  selectOrgScopedSql,
  selectCompanyScopedSql,
  selectRolesActiveSql,
  selectUserProfileByIdentitySql,
  selectUserRoleAssignmentsForIdentitySql,
  selectUserOrganizationForIdentitySql,
  selectCasbinRulesInSubjectsSql,
} from './field-policy'

export type { StdbHttpOptions }
export { stdbSql }
export type { FieldAccessContext, QueryResourceKey } from './field-policy'

/** HTTP options plus optional field-level RBAC context (used by `/api/query`). */
export type StdbServerQueryOptions = StdbHttpOptions & {
  fieldAccess?: FieldAccessContext
}

function fq(opts?: StdbServerQueryOptions): FieldAccessContext | undefined {
  return opts?.fieldAccess
}

/** SpacetimeDB HTTP SQL does not support `deleted_at IS NULL` — filter after fetch (rows use camelCase keys). */
function rowNotSoftDeleted(r: Record<string, unknown>): boolean {
  return r.deletedAt == null
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

/** Company row ids for an organization (no SQL subqueries — SpacetimeDB HTTP SQL limitation). */
async function companyIdsForOrganization(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
): Promise<bigint[]> {
  const org = typeof organizationId === 'bigint' ? organizationId : BigInt(organizationId)
  const sql = selectOrgScopedSql('companies', 'company', org, fq(opts), '', '')
  const rows = await stdbSql<Record<string, unknown>>(sql, httpOpts(opts))
  const out: bigint[] = []
  for (const r of rows) {
    if (!rowNotSoftDeleted(r)) continue
    const v = r.id
    if (v == null) continue
    try {
      const b = BigInt(String(v))
      if (b > 0n) out.push(b)
    } catch {
      /* skip */
    }
  }
  return out
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      String(a.code ?? '').localeCompare(String(b.code ?? '')),
    ),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    ),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => {
      const la = Number(a.level ?? 0)
      const lb = Number(b.level ?? 0)
      if (la !== lb) return la - lb
      return String(a.name ?? '').localeCompare(String(b.name ?? ''))
    }),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      Number(b.dateFrom ?? 0) - Number(a.dateFrom ?? 0),
    ),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      Number(b.dateFrom ?? 0) - Number(a.dateFrom ?? 0),
    ),
  )
}

/** Legal entities (companies) for the tenant — excludes soft-deleted rows. */
export function serverQueryCompanies(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'companies',
      'company',
      organizationId,
      fq(opts),
      '',
      '',
    ),
    httpOpts(opts),
  ).then(rows => {
    const live = (rows as Record<string, unknown>[]).filter(rowNotSoftDeleted)
    return sortSqlRows(live, (a, b) => {
      const pa = Boolean(a.isParent ?? a.is_parent)
      const pb = Boolean(b.isParent ?? b.is_parent)
      const byParent = Number(pb) - Number(pa)
      if (byParent !== 0) return byParent
      return Number(a.id ?? 0) - Number(b.id ?? 0)
    })
  })
}

export function serverQueryDataClassifications(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'data-classifications',
      'data_classification',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY level ASC, id ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryDataClassificationRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'data-classification-rules',
      'data_classification_rule',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id ASC',
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

export function serverQueryAccountMoveLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-move-lines',
      'account_move_line',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY move_id ASC, sequence ASC',
    ),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      Number(b.id ?? 0) - Number(a.id ?? 0),
    ),
  )
}

export function serverQueryAccountPaymentTerms(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'account-payment-terms',
      'account_payment_term',
      organizationId,
      fq(opts),
      '',
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    ),
  )
}

/** Payment term lines for terms belonging to the organization (no JOIN — HTTP SQL limitation). */
export async function serverQueryAccountPaymentTermLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const org = typeof organizationId === 'bigint' ? organizationId : BigInt(organizationId)
  const termSql = selectOrgScopedSql(
    'account-payment-terms',
    'account_payment_term',
    org,
    fq(opts),
    '',
    '',
  )
  const terms = await stdbSql<Record<string, unknown>>(termSql, httpOpts(opts))
  const termIds: bigint[] = []
  for (const t of terms) {
    const v = t.id
    if (v == null) continue
    try {
      const b = BigInt(String(v))
      if (b > 0n) termIds.push(b)
    } catch {
      /* skip */
    }
  }
  if (termIds.length === 0) return []
  const colPart = resolveHttpSqlColumns('account-payment-term-lines', fq(opts)).join(', ')
  const orClause = termIds.map(id => `payment_term_id = ${id}`).join(' OR ')
  const rows = await stdbSql<Record<string, unknown>>(
    `SELECT ${colPart} FROM account_payment_term_line WHERE ${orClause}`,
    httpOpts(opts),
  )
  return sortSqlRows(rows, (a, b) => {
    const pa = Number(a.paymentTermId ?? 0)
    const pb = Number(b.paymentTermId ?? 0)
    if (pa !== pb) return pa - pb
    return Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
  })
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      Number(b.date ?? 0) - Number(a.date ?? 0),
    ),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
    ),
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
      '',
    ),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) =>
      Number(b.id ?? 0) - Number(a.id ?? 0),
    ),
  )
}

export async function serverQueryAccountAssets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  if (companyIds.length === 0) return []
  const colPart = resolveHttpSqlColumns('account-assets', fq(opts)).join(', ')
  const list = companyIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM account_asset WHERE company_id IN (${list})`,
    httpOpts(opts),
  )
}

/** Same rows as {@link serverQueryAccountAssets} — alias for web hooks using `fixed-assets`. */
export function serverQueryFixedAssets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return serverQueryAccountAssets(organizationId, opts)
}

export async function serverQueryDepreciationLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  if (companyIds.length === 0) return []
  const list = companyIds.map(String).join(', ')
  const idRows = await stdbSql<Record<string, unknown>>(
    `SELECT id FROM account_asset WHERE company_id IN (${list})`,
    httpOpts(opts),
  )
  const assetIds: bigint[] = []
  for (const r of idRows) {
    const v = r.id
    if (v == null) continue
    try {
      const b = BigInt(String(v))
      if (b > 0n) assetIds.push(b)
    } catch {
      /* skip */
    }
  }
  if (assetIds.length === 0) return []
  const colPart = resolveHttpSqlColumns('depreciation-lines', fq(opts)).join(', ')
  const alist = assetIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM account_asset_depreciation_line WHERE asset_id IN (${alist})`,
    httpOpts(opts),
  )
}

export function serverQueryTaxGroups(organizationId: bigint | number, opts?: StdbServerQueryOptions) {
  return stdbSql(
    selectOrgScopedSql('tax-groups', 'account_tax_group', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryTaxJurisdictions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('tax-jurisdictions', 'tax_jurisdiction', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryTaxSchedules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('tax-schedules', 'tax_schedule', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryTaxDeadlines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('tax-deadlines', 'tax_deadline', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export async function serverQueryIntercompanyRules(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  if (companyIds.length === 0) return []
  const colPart = resolveHttpSqlColumns('intercompany-rules', fq(opts)).join(', ')
  const list = companyIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM intercompany_rule WHERE source_company_id IN (${list}) OR destination_company_id IN (${list}) ORDER BY sequence ASC`,
    httpOpts(opts),
  )
}

export async function serverQueryIntercompanyTransactions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  if (companyIds.length === 0) return []
  const colPart = resolveHttpSqlColumns('intercompany-transactions', fq(opts)).join(', ')
  const list = companyIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM intercompany_transaction WHERE origin_company_id IN (${list}) OR destination_company_id IN (${list}) ORDER BY id DESC`,
    httpOpts(opts),
  )
}

// CONSOLIDATION (no organization_id — global tables, full scan)

export function serverQueryConsolidationAccounts(
  _organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const colPart = resolveHttpSqlColumns('consolidation-accounts', fq(opts)).join(', ')
  return stdbSql(`SELECT ${colPart} FROM consolidation_account`, httpOpts(opts))
}

export function serverQueryConsolidationJournals(
  _organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const colPart = resolveHttpSqlColumns('consolidation-journals', fq(opts)).join(', ')
  return stdbSql(`SELECT ${colPart} FROM consolidation_journal`, httpOpts(opts))
}

export function serverQueryConsolidationEliminationEntries(
  _organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const colPart = resolveHttpSqlColumns('consolidation-elimination-entries', fq(opts)).join(', ')
  return stdbSql(`SELECT ${colPart} FROM consolidation_elimination_entry`, httpOpts(opts))
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

export function serverQueryReturnOrders(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('return-orders', 'return_order', organizationId, fq(opts), '', ' ORDER BY id DESC'),
    httpOpts(opts),
  )
}

export function serverQueryReturnOrderLines(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'return-order-lines',
      'return_order_line',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY return_order_id ASC, id ASC',
    ),
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

export async function serverQueryPickingBatches(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  if (companyIds.length === 0) return []
  const colPart = resolveHttpSqlColumns('picking-batches', fq(opts)).join(', ')
  const list = companyIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM stock_picking_batch WHERE company_id IN (${list})`,
    httpOpts(opts),
  )
}

/** `company_id` scoped (pass the same numeric scope as sale pickings / `orgBigInts().companyId`). */
export function serverQueryDeliveryCarriers(
  companyId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectCompanyScopedSql('delivery-carriers', 'delivery_carrier', companyId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryDeliveryPriceRules(
  companyId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectCompanyScopedSql('delivery-price-rules', 'delivery_price_rule', companyId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryShippingMethods(
  companyId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectCompanyScopedSql('shipping-methods', 'shipping_method', companyId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPosPaymentMethods(
  companyId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectCompanyScopedSql('pos-payment-methods', 'pos_payment_method', companyId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryPosLoyaltyPrograms(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'pos-loyalty-programs',
      'pos_loyalty_program',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryPosLoyaltyCards(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'pos-loyalty-cards',
      'pos_loyalty_card',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryPartnerBanks(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('partner-banks', 'res_partner_bank', organizationId, fq(opts), ''),
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
  ).then(rows => (rows as Record<string, unknown>[]).filter(rowNotSoftDeleted))
}

export async function serverQueryLeadById(
  id: number,
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const colPart = resolveHttpSqlColumns('leads', fq(opts)).join(', ')
  const rows = await stdbSql<Record<string, unknown>>(
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
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  ).then(rows => (rows as Record<string, unknown>[]).filter(rowNotSoftDeleted))
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
      '',
    ),
    httpOpts(opts),
  ).then(rows => (rows as Record<string, unknown>[]).filter(rowNotSoftDeleted))
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

export function serverQueryAdjustmentReasons(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'adjustment-reasons',
      'adjustment_reason',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY code ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryBarcodeNomenclatures(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'barcode-nomenclatures',
      'barcode_nomenclature',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY name ASC',
    ),
    httpOpts(opts),
  )
}

export function serverQuerySerialLotTraceability(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'serial-lot-traceability',
      'serial_lot_traceability',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
    httpOpts(opts),
  )
}

export function serverQueryStockTraceabilityReports(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'stock-traceability-reports',
      'stock_traceability_report',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY id DESC',
    ),
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

export function serverQueryMrpRoutingWorkcenters(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'mrp-routing-workcenters',
      'mrp_routing_workcenter',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY workcenter_id ASC, sequence ASC',
    ),
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

export function serverQueryKnowledgeCategories(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'knowledge-categories',
      'kb_category',
      organizationId,
      fq(opts),
      '',
    ),
    httpOpts(opts),
  )
}

export function serverQueryDocumentFolders(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('document-folders', 'doc_folder', organizationId, fq(opts), ''),
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

export function serverQueryMailFollowers(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('mail-followers', 'mail_follower', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

function formConfigurationIdsFromRows(configs: Record<string, unknown>[]): bigint[] {
  const ids: bigint[] = []
  for (const c of configs) {
    const v = c.id
    if (v == null) continue
    try {
      const b = BigInt(String(v))
      if (b > 0n) ids.push(b)
    } catch {
      /* skip */
    }
  }
  return ids
}

export function serverQueryFormConfigs(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('form-configs', 'form_config', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export async function serverQueryFormConfigFields(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const configs = (await serverQueryFormConfigs(organizationId, opts)) as Record<string, unknown>[]
  const ids = formConfigurationIdsFromRows(configs)
  if (ids.length === 0) return []
  const colPart = resolveHttpSqlColumns('form-config-fields', fq(opts)).join(', ')
  const list = ids.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM form_config_field WHERE configuration_id IN (${list})`,
    httpOpts(opts),
  )
}

export async function serverQueryFormRoleConfigs(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const configs = (await serverQueryFormConfigs(organizationId, opts)) as Record<string, unknown>[]
  const ids = formConfigurationIdsFromRows(configs)
  if (ids.length === 0) return []
  const colPart = resolveHttpSqlColumns('form-role-configs', fq(opts)).join(', ')
  const list = ids.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM form_role_config WHERE configuration_id IN (${list})`,
    httpOpts(opts),
  )
}

export function serverQueryUserCustomFields(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('user-custom-fields', 'user_custom_field', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryUtmCampaigns(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('utm-campaigns', 'utm_campaign', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryUtmMedia(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('utm-media', 'utm_medium', organizationId, fq(opts), ''),
    httpOpts(opts),
  )
}

export function serverQueryUtmSources(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('utm-sources', 'utm_source', organizationId, fq(opts), ''),
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

export function serverQuerySavedReports(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('saved-reports', 'saved_report', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => Number(b.id ?? 0) - Number(a.id ?? 0)),
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

export function serverQueryDashboards(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('dashboards', 'dashboard', organizationId, fq(opts), ''),
    httpOpts(opts),
  ).then(rows =>
    sortSqlRows(rows as Record<string, unknown>[], (a, b) => Number(b.id ?? 0) - Number(a.id ?? 0)),
  )
}

export function serverQueryDashboardWidgets(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql('dashboard-widgets', 'dashboard_widget', organizationId, fq(opts), ''),
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

export async function serverQueryPosConfigs(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  if (companyIds.length === 0) return []
  const list = companyIds.map(String).join(', ')
  const colPart = resolveHttpSqlColumns('pos-configs', fq(opts)).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM pos_config WHERE company_id IN (${list}) ORDER BY name ASC`,
    httpOpts(opts),
  )
}

export async function serverQueryPosSessions(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const configs = await serverQueryPosConfigs(organizationId, opts)
  const configIds: string[] = []
  for (const row of configs) {
    const id = row.id
    if (id != null && String(id).trim() !== '') configIds.push(String(id))
  }
  if (configIds.length === 0) return []
  const list = configIds.join(', ')
  const colPart = resolveHttpSqlColumns('pos-sessions', fq(opts)).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM pos_session WHERE config_id IN (${list}) ORDER BY start_at DESC`,
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

export function serverQueryIotPairingTokens(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  return stdbSql(
    selectOrgScopedSql(
      'iot-pairing-tokens',
      'iot_pairing_token',
      organizationId,
      fq(opts),
      '',
      ' ORDER BY created_at DESC',
    ),
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
export async function serverQueryAiInsights(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  const colPart = resolveHttpSqlColumns('ai-insights', fq(opts)).join(', ')
  if (companyIds.length === 0) {
    return stdbSql(
      `SELECT ${colPart} FROM ai_insight WHERE company_id IS NULL`,
      httpOpts(opts),
    )
  }
  const list = companyIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM ai_insight WHERE company_id IN (${list}) OR company_id IS NULL`,
    httpOpts(opts),
  )
}

/** Document AI processing jobs (org companies + tenant-wide null company). */
export async function serverQueryAiDocumentProcessingJobs(
  organizationId: bigint | number,
  opts?: StdbServerQueryOptions,
) {
  const companyIds = await companyIdsForOrganization(organizationId, opts)
  const colPart = resolveHttpSqlColumns('ai-document-processing-jobs', fq(opts)).join(', ')
  if (companyIds.length === 0) {
    return stdbSql(
      `SELECT ${colPart} FROM ai_document_processing_job WHERE company_id IS NULL`,
      httpOpts(opts),
    )
  }
  const list = companyIds.map(String).join(', ')
  return stdbSql(
    `SELECT ${colPart} FROM ai_document_processing_job WHERE company_id IN (${list}) OR company_id IS NULL`,
    httpOpts(opts),
  )
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
  const colUo = resolveHttpSqlColumns('user-organization', fq(opts)).join(', ')
  const memberships = await stdbSql<{ userIdentity: string }>(
    `SELECT ${colUo} FROM user_organization WHERE organization_id = ${organizationId} AND is_active = true`,
    httpOpts(opts),
  )
  if (memberships.length === 0) return []
  // SpacetimeDB HTTP SQL rejects `identity IN (...)` for Identity columns; use `=` + OR (see selectUserProfileByIdentitySql).
  const rawIds = memberships.map((m) => String(m.userIdentity))
  const uniqueIds = [...new Set(rawIds)]
  const esc = (s: string) => s.replace(/'/g, "''")
  const colP = resolveHttpSqlColumns('user-profile', fq(opts)).join(', ')
  const whereIdentity =
    uniqueIds.length === 1
      ? `identity = '${esc(uniqueIds[0])}'`
      : `(${uniqueIds.map((id) => `identity = '${esc(id)}'`).join(' OR ')})`
  const sqlProfile = `SELECT ${colP} FROM user_profile WHERE ${whereIdentity}`
  return stdbSql(sqlProfile, httpOpts(opts))
}
