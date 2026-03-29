/**
 * Field-level read policy for SpacetimeDB SQL (API / subscriptions).
 *
 * - Admin: `user_profile.is_superuser`, role permission `*:*`, or Casbin `p` rule
 *   with v2=* and v3=* (and v4=allow when present) → full row (`SELECT *`).
 * - Otherwise: Casbin `metadata` JSON `{ "fields": ["col_a", ...] }` on a `p` rule
 *   where v1=org id, v0 matches identity or role id or role name, v2 matches resource
 *   key or table name, v3 is `read` or `*`.
 * - If no matching field rule: use per-resource `defaultRestricted` (minimal columns).
 *
 * Column names are SQL identifiers (snake_case). Reserved words like `type` are allowed
 * when validated by {@link assertSafeSqlIdentifiers}.
 *
 * Default and mandatory column sets are built from generated row types via {@link sqlFieldNames}
 * so renames in `generated/types.ts` surface as compile errors here.
 */

import type {
  AccountAccount,
  AccountAnalyticAccount,
  AccountJournal,
  AccountMove,
  AccountTax,
  CalendarEvent,
  CasbinRule,
  Contact,
  CrossoveredBudget,
  DeferredRevenueLine,
  DeferredRevenueSchedule,
  Document,
  FinancialReport,
  HelpdeskSla,
  HelpdeskStage,
  HelpdeskTeam,
  HelpdeskTicket,
  HrContract,
  HrDepartment,
  HrEmployee,
  HrExpense,
  HrExpenseSheet,
  HrLeave,
  HrPayslip,
  InventoryAdjustment,
  KnowledgeArticle,
  Lead,
  MailMessage,
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpWorkcenter,
  MrpWorkorder,
  Opportunity,
  OpportunityStage,
  Product,
  ProductCategory,
  ProductPricelist,
  ProductPricelistItem,
  ProjectProject,
  ProjectTask,
  ProjectTimesheet,
  Proposal,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequisition,
  RevenueRecognitionRule,
  Role,
  SaleOrder,
  SaleOrderLine,
  StockPicking,
  StockPickingBatch,
  StockQuant,
  Subscription,
  SubscriptionPlan,
  TrialBalance,
  Uom,
  AccountPayment,
  Activity,
  AnalyticsMetric,
  BarcodeRule,
  ReportTemplate,
  ScheduledReport,
  InventoryValuation,
  PickingWave,
  QualityCheck,
  ReplenishmentRule,
  StockCycleCount,
  StockInventory,
  StockLocation,
  StockMove,
  StockProductionLot,
  StockProductionSerial,
  StockRoute,
  StockRule,
  UserOrganization,
  UserProfile,
  UserRoleAssignment,
  Warehouse,
  Warehouse3DZone,
  WarehouseTask,
  Workflow,
  WorkflowActivity,
  WorkflowInstance,
  WorkflowTransition,
  WorkflowWorkitem,
} from './generated/types'

import { sqlFieldNames } from './sql-field-names'

export type QueryResourceKey =
  | 'account-accounts'
  | 'account-journals'
  | 'account-moves'
  | 'account-taxes'
  | 'account-payments'
  | 'budgets'
  | 'analytic-accounts'
  | 'sale-orders'
  | 'sale-order-lines'
  | 'pricelists'
  | 'pricelist-items'
  | 'picking-batches'
  | 'leads'
  | 'opportunities'
  | 'opportunity-stages'
  | 'contacts'
  | 'activities'
  | 'projects'
  | 'tasks'
  | 'timesheets'
  | 'products'
  | 'product-categories'
  | 'uoms'
  | 'stock-quants'
  | 'stock-pickings'
  | 'warehouses'
  | 'inventory-adjustments'
  | 'stock-locations'
  | 'stock-production-lots'
  | 'stock-production-serials'
  | 'quality-checks'
  | 'warehouse-3d-zones'
  | 'stock-cycle-counts'
  | 'stock-inventories'
  | 'stock-moves'
  | 'stock-routes'
  | 'stock-rules'
  | 'picking-waves'
  | 'warehouse-tasks'
  | 'replenishment-rules'
  | 'barcode-rules'
  | 'inventory-valuations'
  | 'purchase-orders'
  | 'purchase-order-lines'
  | 'purchase-requisitions'
  | 'mrp-productions'
  | 'mrp-boms'
  | 'mrp-bom-lines'
  | 'mrp-workorders'
  | 'mrp-workcenters'
  | 'employees'
  | 'departments'
  | 'leave-requests'
  | 'contracts'
  | 'payslips'
  | 'financial-reports'
  | 'trial-balances'
  | 'report-templates'
  | 'scheduled-reports'
  | 'analytics-metrics'
  | 'documents'
  | 'knowledge-articles'
  | 'helpdesk-tickets'
  | 'helpdesk-teams'
  | 'helpdesk-stages'
  | 'helpdesk-slas'
  | 'subscriptions'
  | 'subscription-plans'
  | 'deferred-revenue-schedules'
  | 'deferred-revenue-lines'
  | 'revenue-recognition-rules'
  | 'workflows'
  | 'workflow-activities'
  | 'workflow-instances'
  | 'workflow-transitions'
  | 'workflow-workitems'
  | 'proposals'
  | 'calendar-events'
  | 'mail-messages'
  | 'expenses'
  | 'expense-sheets'
  | 'roles'
  | 'user-roles'
  | 'user-profile'
  | 'user-role-assignment'
  | 'user-organization'
  | 'casbin-rule'

export interface FieldAccessContext {
  organizationId: number
  roleId: number
  roleName: string
  isSuperuser: boolean
  rolePermissions: readonly string[]
  identityHex: string
  casbinRules: ReadonlyArray<CasbinRuleLike>
}

export interface CasbinRuleLike {
  ptype: string
  v0?: string | null
  v1?: string | null
  v2?: string | null
  v3?: string | null
  v4?: string | null
  v5?: string | null
  metadata?: string | null
}

type ResourceEntry = {
  /** SQL table name */
  table: string
  /** v2 can match resource key and/or table name */
  aliases: string[]
  /** When no explicit Casbin field list applies */
  defaultRestricted: string[]
  /** Extra columns always included when projecting (tenant keys) */
  mandatory: string[]
}

function entry<T extends object>(
  table: string,
  aliases: string[],
  defaultRestrictedKeys: readonly (keyof T)[],
  mandatoryKeys: readonly (keyof T)[],
): ResourceEntry {
  return {
    table,
    aliases,
    defaultRestricted: sqlFieldNames<T>(defaultRestrictedKeys),
    mandatory: sqlFieldNames<T>(mandatoryKeys),
  }
}

/** Tables scoped by `organization_id` in SQL (see `selectOrgScopedSql`). */
function orgEntry<T extends { id: unknown; organizationId: unknown }>(
  table: string,
  aliases: string[],
  defaultRestrictedKeys: readonly (keyof T)[],
): ResourceEntry {
  const mandatory = ['id', 'organizationId'] as readonly (keyof T)[]
  return entry<T>(table, aliases, defaultRestrictedKeys, mandatory)
}

/**
 * Registry: default column sets for non-privileged users without a Casbin field list.
 * Keys use generated row types (`keyof`) so drift from `generated/types.ts` fails typecheck.
 */
export const RESOURCE_REGISTRY: Record<QueryResourceKey, ResourceEntry> = {
  'account-accounts': orgEntry<AccountAccount>('account_account', ['account-accounts', 'account_account'], [
    'code', 'name', 'deprecated', 'used', 'companyId', 'internalGroup', 'isBankAccount',
  ]),
  'account-journals': orgEntry<AccountJournal>('account_journal', ['account-journals', 'account_journal'], [
    'code', 'name', 'companyId',
  ]),
  'account-moves': orgEntry<AccountMove>('account_move', ['account-moves', 'account_move'], [
    'name', 'moveType', 'state', 'date', 'companyId',
  ]),
  'account-taxes': orgEntry<AccountTax>('account_tax', ['account-taxes', 'account_tax'], [
    'name', 'amount', 'companyId',
  ]),
  'account-payments': orgEntry<AccountPayment>('account_payment', ['account-payments', 'account_payment'], [
    'name', 'amount', 'companyId', 'state', 'ref', 'journalId', 'currencyId', 'partnerId',
  ]),
  budgets: orgEntry<CrossoveredBudget>('crossovered_budget', ['budgets', 'crossovered_budget'], [
    'name', 'companyId', 'state',
  ]),
  'analytic-accounts': orgEntry<AccountAnalyticAccount>(
    'account_analytic_account',
    ['analytic-accounts', 'account_analytic_account'],
    ['name', 'code', 'companyId', 'balance'],
  ),
  'sale-orders': orgEntry<SaleOrder>('sale_order', ['sale-orders', 'sale_order'], [
    'reference', 'state', 'partnerId', 'companyId', 'dateOrder',
  ]),
  'sale-order-lines': orgEntry<SaleOrderLine>('sale_order_line', ['sale-order-lines', 'sale_order_line'], [
    'name', 'orderId', 'productId', 'productUomQty', 'priceUnit',
  ]),
  pricelists: orgEntry<ProductPricelist>('product_pricelist', ['pricelists', 'product_pricelist'], [
    'name', 'currencyId', 'isActive',
  ]),
  'pricelist-items': orgEntry<ProductPricelistItem>(
    'product_pricelist_item',
    ['pricelist-items', 'product_pricelist_item'],
    ['pricelistId', 'sequence', 'appliedOn', 'computePrice', 'fixedPrice', 'productId', 'minQuantity'],
  ),
  'picking-batches': entry<StockPickingBatch>(
    'stock_picking_batch',
    ['picking-batches', 'stock_picking_batch'],
    ['name', 'state'],
    ['id', 'companyId'] as readonly (keyof StockPickingBatch)[],
  ),
  leads: orgEntry<Lead>('lead', ['leads', 'lead'], [
    'name', 'contactName', 'email', 'phone', 'state', 'probability',
  ]),
  opportunities: orgEntry<Opportunity>('opportunity', ['opportunities', 'opportunity'], [
    'name', 'partnerId', 'stageId', 'probability', 'companyId',
  ]),
  'opportunity-stages': orgEntry<OpportunityStage>(
    'opp_stage',
    ['opportunity-stages', 'opp_stage'],
    ['name', 'sequence'],
  ),
  contacts: orgEntry<Contact>('contact', ['contacts', 'contact'], [
    'name', 'email', 'phone', 'parentId', 'companyId',
  ]),
  activities: orgEntry<Activity>('activity', ['activities', 'activity'], [
    'summary', 'activityType', 'state', 'dateDeadline', 'assignedTo', 'isDone',
  ]),
  projects: orgEntry<ProjectProject>('project_project', ['projects', 'project_project'], [
    'name', 'companyId', 'active',
  ]),
  tasks: orgEntry<ProjectTask>('project_task', ['tasks', 'project_task'], [
    'name', 'projectId', 'companyId',
  ]),
  timesheets: orgEntry<ProjectTimesheet>('project_timesheet', ['timesheets', 'project_timesheet'], [
    'name', 'employeeId', 'companyId',
  ]),
  products: orgEntry<Product>('product', ['products', 'product'], [
    'name', 'displayName', 'code', 'defaultCode', 'active', 'categId', 'listPrice', 'publicPrice', 'type', 'barcode',
  ]),
  'product-categories': orgEntry<ProductCategory>('product_category', ['product-categories', 'product_category'], [
    'name', 'parentId', 'companyId',
  ]),
  uoms: orgEntry<Uom>('uom', ['uoms', 'uom'], ['name', 'categoryId', 'symbol']),
  'stock-quants': orgEntry<StockQuant>('stock_quant', ['stock-quants', 'stock_quant'], [
    'productId', 'locationId', 'quantity', 'companyId',
  ]),
  'stock-pickings': orgEntry<StockPicking>('stock_picking', ['stock-pickings', 'stock_picking'], [
    'name', 'state', 'companyId',
  ]),
  warehouses: orgEntry<Warehouse>('warehouse', ['warehouses', 'warehouse'], [
    'name', 'code', 'companyId', 'active',
  ]),
  'inventory-adjustments': orgEntry<InventoryAdjustment>(
    'inventory_adjustment',
    ['inventory-adjustments', 'inventory_adjustment'],
    ['name', 'state'],
  ),
  'stock-locations': orgEntry<StockLocation>('stock_location', ['stock-locations', 'stock_location'], [
    'name', 'usage', 'completeName', 'companyId', 'locationId',
  ]),
  'stock-production-lots': orgEntry<StockProductionLot>(
    'stock_production_lot',
    ['stock-production-lots', 'stock_production_lot'],
    ['name', 'productId', 'companyId', 'ref'],
  ),
  'stock-production-serials': orgEntry<StockProductionSerial>(
    'stock_production_serial',
    ['stock-production-serials', 'stock_production_serial'],
    ['name', 'productId', 'companyId', 'lotId'],
  ),
  'quality-checks': orgEntry<QualityCheck>('quality_check', ['quality-checks', 'quality_check'], [
    'name', 'qualityState', 'companyId', 'productId',
  ]),
  'warehouse-3d-zones': orgEntry<Warehouse3DZone>(
    'warehouse_3d_zone',
    ['warehouse-3d-zones', 'warehouse_3d_zone'],
    ['warehouseId', 'locationId', 'isActive'],
  ),
  'stock-cycle-counts': orgEntry<StockCycleCount>(
    'stock_cycle_count',
    ['stock-cycle-counts', 'stock_cycle_count'],
    ['name', 'state', 'locationId', 'companyId'],
  ),
  'stock-inventories': orgEntry<StockInventory>(
    'stock_inventory',
    ['stock-inventories', 'stock_inventory'],
    ['name', 'state', 'companyId'],
  ),
  'stock-moves': orgEntry<StockMove>('stock_move', ['stock-moves', 'stock_move'], [
    'state', 'productId', 'companyId', 'pickingId',
  ]),
  'stock-routes': orgEntry<StockRoute>('stock_route', ['stock-routes', 'stock_route'], [
    'name', 'active', 'companyId',
  ]),
  'stock-rules': orgEntry<StockRule>('stock_rule', ['stock-rules', 'stock_rule'], [
    'name', 'action', 'active', 'companyId',
  ]),
  'picking-waves': orgEntry<PickingWave>(
    'picking_wave',
    ['picking-waves', 'picking_wave'],
    ['name', 'state', 'companyId', 'pickingTypeId'],
  ),
  'warehouse-tasks': orgEntry<WarehouseTask>(
    'warehouse_task',
    ['warehouse-tasks', 'warehouse_task'],
    ['name', 'state', 'taskType', 'companyId', 'pickingId'],
  ),
  'replenishment-rules': orgEntry<ReplenishmentRule>(
    'replenishment_rule',
    ['replenishment-rules', 'replenishment_rule'],
    ['productId', 'locationId', 'companyId', 'active'],
  ),
  'barcode-rules': orgEntry<BarcodeRule>(
    'barcode_rule',
    ['barcode-rules', 'barcode_rule'],
    ['name', 'pattern', 'encoding', 'isActive'],
  ),
  'inventory-valuations': orgEntry<InventoryValuation>(
    'inventory_valuation',
    ['inventory-valuations', 'inventory_valuation'],
    ['productId', 'locationId', 'companyId', 'active'],
  ),
  'purchase-orders': orgEntry<PurchaseOrder>('purchase_order', ['purchase-orders', 'purchase_order'], [
    'name', 'state', 'partnerId', 'companyId',
  ]),
  'purchase-order-lines': orgEntry<PurchaseOrderLine>(
    'purchase_order_line',
    ['purchase-order-lines', 'purchase_order_line'],
    ['orderId', 'productId', 'productQty', 'priceUnit'],
  ),
  'purchase-requisitions': orgEntry<PurchaseRequisition>(
    'purchase_requisition',
    ['purchase-requisitions', 'purchase_requisition'],
    ['state', 'companyId', 'description'],
  ),
  'mrp-productions': orgEntry<MrpProduction>('mrp_production', ['mrp-productions', 'mrp_production'], [
    'state', 'productId', 'companyId',
  ]),
  'mrp-boms': orgEntry<MrpBom>('mrp_bom', ['mrp-boms', 'mrp_bom'], ['productTmplId', 'companyId', 'type']),
  'mrp-bom-lines': orgEntry<MrpBomLine>('mrp_bom_line', ['mrp-bom-lines', 'mrp_bom_line'], [
    'bomId',
    'productId',
    'companyId',
  ]),
  'mrp-workorders': orgEntry<MrpWorkorder>('mrp_workorder', ['mrp-workorders', 'mrp_workorder'], [
    'state', 'productionId', 'companyId',
  ]),
  'mrp-workcenters': orgEntry<MrpWorkcenter>('mrp_workcenter', ['mrp-workcenters', 'mrp_workcenter'], [
    'name', 'companyId',
  ]),
  employees: orgEntry<HrEmployee>('hr_employee', ['employees', 'hr_employee'], [
    'name', 'workEmail', 'departmentId', 'companyId',
  ]),
  departments: orgEntry<HrDepartment>('hr_department', ['departments', 'hr_department'], ['name', 'companyId']),
  'leave-requests': orgEntry<HrLeave>('hr_leave', ['leave-requests', 'hr_leave'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  contracts: orgEntry<HrContract>('hr_contract', ['contracts', 'hr_contract'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  payslips: orgEntry<HrPayslip>('hr_payslip', ['payslips', 'hr_payslip'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  'financial-reports': entry<FinancialReport>(
    'financial_report',
    ['financial-reports', 'financial_report'],
    ['name', 'state', 'reportType'],
    ['id', 'organizationId', 'companyId'] as readonly (keyof FinancialReport)[],
  ),
  'trial-balances': entry<TrialBalance>(
    'trial_balance',
    ['trial-balances', 'trial_balance'],
    ['reportId', 'accountCode', 'accountName'],
    ['id', 'organizationId', 'companyId'] as readonly (keyof TrialBalance)[],
  ),
  'report-templates': orgEntry<ReportTemplate>(
    'report_template',
    ['report-templates', 'report_template'],
    ['name', 'model', 'reportType', 'isActive'],
  ),
  'scheduled-reports': orgEntry<ScheduledReport>(
    'scheduled_report',
    ['scheduled-reports', 'scheduled_report'],
    ['name', 'frequency', 'nextRun', 'isActive'],
  ),
  'analytics-metrics': orgEntry<AnalyticsMetric>(
    'analytics_metric',
    ['analytics-metrics', 'analytics_metric'],
    ['name', 'category', 'metricType', 'isActive'],
  ),
  documents: orgEntry<Document>('document', ['documents', 'document'], ['name', 'companyId']),
  'knowledge-articles': orgEntry<KnowledgeArticle>(
    'knowledge_article',
    ['knowledge-articles', 'knowledge_article'],
    ['name', 'isPublished'],
  ),
  'helpdesk-tickets': orgEntry<HelpdeskTicket>('helpdesk_ticket', ['helpdesk-tickets', 'helpdesk_ticket'], [
    'name', 'partnerId', 'stageId',
  ]),
  'helpdesk-teams': orgEntry<HelpdeskTeam>('helpdesk_team', ['helpdesk-teams', 'helpdesk_team'], [
    'name', 'isActive',
  ]),
  'helpdesk-stages': orgEntry<HelpdeskStage>('helpdesk_stage', ['helpdesk-stages', 'helpdesk_stage'], [
    'name', 'sequence',
  ]),
  'helpdesk-slas': orgEntry<HelpdeskSla>('helpdesk_sla', ['helpdesk-slas', 'helpdesk_sla'], [
    'name', 'teamId', 'stageId', 'priority',
  ]),
  subscriptions: orgEntry<Subscription>('subscription', ['subscriptions', 'subscription'], [
    'code', 'state', 'companyId', 'description',
  ]),
  'subscription-plans': orgEntry<SubscriptionPlan>(
    'subscription_plan',
    ['subscription-plans', 'subscription_plan'],
    ['name', 'companyId', 'active'],
  ),
  'deferred-revenue-schedules': orgEntry<DeferredRevenueSchedule>(
    'deferred_revenue_schedule',
    ['deferred-revenue-schedules', 'deferred_revenue_schedule'],
    ['description', 'state', 'totalAmount', 'companyId'],
  ),
  'deferred-revenue-lines': orgEntry<DeferredRevenueLine>(
    'deferred_revenue_line',
    ['deferred-revenue-lines', 'deferred_revenue_line'],
    ['scheduleId', 'amount', 'recognized', 'companyId'],
  ),
  'revenue-recognition-rules': orgEntry<RevenueRecognitionRule>(
    'revenue_recognition_rule',
    ['revenue-recognition-rules', 'revenue_recognition_rule'],
    ['description', 'isActive', 'priority', 'companyId'],
  ),
  workflows: orgEntry<Workflow>('workflow', ['workflows', 'workflow'], ['name', 'companyId', 'isActive']),
  'workflow-activities': orgEntry<WorkflowActivity>(
    'workflow_activity',
    ['workflow-activities', 'workflow_activity'],
    ['name', 'workflowId', 'kind', 'flowStart', 'sequence'],
  ),
  'workflow-instances': orgEntry<WorkflowInstance>(
    'workflow_instance',
    ['workflow-instances', 'workflow_instance'],
    ['workflowId', 'state', 'resId'],
  ),
  'workflow-transitions': orgEntry<WorkflowTransition>(
    'workflow_transition',
    ['workflow-transitions', 'workflow_transition'],
    ['activityFrom', 'activityTo', 'signal', 'sequence'],
  ),
  'workflow-workitems': orgEntry<WorkflowWorkitem>(
    'workflow_workitem',
    ['workflow-workitems', 'workflow_workitem'],
    ['instanceId', 'actId', 'state'],
  ),
  proposals: orgEntry<Proposal>('proposal', ['proposals', 'proposal'], ['title', 'status', 'clientName']),
  'calendar-events': orgEntry<CalendarEvent>('calendar_event', ['calendar-events', 'calendar_event'], [
    'name', 'start', 'stop', 'state',
  ]),
  'mail-messages': orgEntry<MailMessage>('mail_message', ['mail-messages', 'mail_message'], [
    'model', 'body', 'date', 'resId',
  ]),
  expenses: orgEntry<HrExpense>('hr_expense', ['expenses', 'hr_expense'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  'expense-sheets': orgEntry<HrExpenseSheet>('expense_sheet', ['expense-sheets', 'expense_sheet'], [
    'name', 'state', 'companyId',
  ]),
  roles: orgEntry<Role>('role', ['roles', 'role'], ['name', 'description', 'isActive', 'isSystem']),
  'user-roles': entry<UserRoleAssignment>(
    'user_role_assignment',
    ['user-roles', 'user_role_assignment'],
    ['isActive'],
    ['id', 'userIdentity', 'roleId', 'organizationId'],
  ),
  'user-profile': entry<UserProfile>(
    'user_profile',
    ['user-profile', 'user_profile'],
    ['email', 'name', 'isActive', 'language', 'timezone'],
    ['identity'],
  ),
  'user-role-assignment': entry<UserRoleAssignment>(
    'user_role_assignment',
    ['user-role-assignment'],
    ['isActive'],
    ['id', 'userIdentity', 'roleId', 'organizationId'],
  ),
  'user-organization': entry<UserOrganization>(
    'user_organization',
    ['user-organization', 'user_organization'],
    ['companyId', 'roleId', 'isActive', 'isDefault'],
    ['id', 'userIdentity', 'organizationId'],
  ),
  'casbin-rule': entry<CasbinRule>(
    'casbin_rule',
    ['casbin-rule', 'casbin_rule'],
    ['ptype', 'v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'createdAt'],
    ['id'],
  ),
}

export function assertSafeSqlIdentifiers(cols: string[]): string[] {
  for (const c of cols) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(c)) {
      throw new Error(`Invalid SQL identifier: ${c}`)
    }
  }
  return cols
}

function uniquePreserveOrder(cols: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of cols) {
    if (!seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

function parseFieldsFromMetadata(metadata: string | null | undefined): string[] | null {
  if (!metadata) return null
  try {
    const j = JSON.parse(metadata) as { fields?: unknown }
    if (!Array.isArray(j.fields)) return null
    const raw = j.fields.filter((x): x is string => typeof x === 'string')
    if (raw.length === 0) return null
    return assertSafeSqlIdentifiers(raw.map(s => s.trim()))
  } catch {
    return null
  }
}

function parseFieldsFromV5(v5: string | null | undefined): string[] | null {
  if (!v5?.trim()) return null
  const parts = v5.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  return assertSafeSqlIdentifiers(parts)
}

function matchesResource(v2: string | null | undefined, resourceKey: QueryResourceKey): boolean {
  if (!v2) return false
  const reg = RESOURCE_REGISTRY[resourceKey]
  if (v2 === resourceKey) return true
  return reg.aliases.includes(v2)
}

function subjectMatches(
  v0: string | null | undefined,
  ctx: FieldAccessContext,
): boolean {
  if (!v0) return false
  return (
    v0 === ctx.identityHex
    || v0 === String(ctx.roleId)
    || v0 === ctx.roleName
  )
}

/**
 * @returns `null` = full row access (`SELECT *`), else explicit column list (snake_case).
 */
export function resolveReadColumns(
  resourceKey: QueryResourceKey,
  fieldAccess: FieldAccessContext | undefined,
): string[] | null {
  if (!fieldAccess) return null

  if (fieldAccess.isSuperuser) return null

  if (fieldAccess.rolePermissions.includes('*:*')) return null

  const orgStr = String(fieldAccess.organizationId)
  const reg = RESOURCE_REGISTRY[resourceKey]

  let sawFullWildcard = false
  const fieldBatches: string[][] = []

  for (const rule of fieldAccess.casbinRules) {
    if (rule.ptype !== 'p') continue
    if (!subjectMatches(rule.v0, fieldAccess)) continue
    if (rule.v1 !== orgStr) continue

    const v2 = rule.v2 ?? ''
    const v3 = rule.v3 ?? ''

    if (v2 === '*' && (v3 === '*' || v3 === 'read')) {
      const deny = rule.v4?.toLowerCase() === 'deny'
      if (!deny) sawFullWildcard = true
      continue
    }

    if (!matchesResource(v2, resourceKey)) continue
    if (!(v3 === 'read' || v3 === '*')) continue

    const fromMeta = parseFieldsFromMetadata(rule.metadata ?? null)
    const fromV5 = parseFieldsFromV5(rule.v5 ?? null)
    const fields = fromMeta ?? fromV5
    if (fields?.length) fieldBatches.push(fields)
  }

  if (sawFullWildcard) return null

  if (fieldBatches.length > 0) {
    const merged = uniquePreserveOrder([...reg.mandatory, ...fieldBatches.flat()])
    return assertSafeSqlIdentifiers(merged)
  }

  return assertSafeSqlIdentifiers([...reg.mandatory, ...reg.defaultRestricted])
}

export function selectOrgScopedSql(
  resourceKey: QueryResourceKey,
  table: string,
  organizationId: bigint | number,
  fieldAccess: FieldAccessContext | undefined,
  extraWhere: string,
  orderBy = '',
): string {
  const cols = resolveReadColumns(resourceKey, fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  const where = `organization_id = ${organizationId}${extraWhere}`
  return `SELECT ${colPart} FROM ${table} WHERE ${where}${orderBy}`
}

/** Build SELECT for tables filtered by `company_id` (legacy company scope). */
export function selectCompanyScopedSql(
  resourceKey: QueryResourceKey,
  table: string,
  companyId: bigint | number,
  fieldAccess: FieldAccessContext | undefined,
  extraWhere: string,
  orderBy = '',
): string {
  const cols = resolveReadColumns(resourceKey, fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  const where = `company_id = ${companyId}${extraWhere}`
  return `SELECT ${colPart} FROM ${table} WHERE ${where}${orderBy}`
}

export function selectRawSql(
  resourceKey: QueryResourceKey,
  sqlBody: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveReadColumns(resourceKey, fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  return `SELECT ${colPart} ${sqlBody}`
}

export function selectRolesActiveSql(fieldAccess: FieldAccessContext | undefined): string {
  const cols = resolveReadColumns('roles', fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  return `SELECT ${colPart} FROM role WHERE is_active = true`
}

function sqlQuoteIdentityHex(s: string): string {
  return s.replace(/'/g, "''")
}

export function selectUserProfileByIdentitySql(
  identityHex: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveReadColumns('user-profile', fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  const id = sqlQuoteIdentityHex(identityHex)
  return `SELECT ${colPart} FROM user_profile WHERE identity = '${id}' LIMIT 1`
}

export function selectUserRoleAssignmentsForIdentitySql(
  identityHex: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveReadColumns('user-roles', fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  const id = sqlQuoteIdentityHex(identityHex)
  return `SELECT ${colPart} FROM user_role_assignment WHERE user_identity = '${id}' AND is_active = true`
}

export function selectUserOrganizationForIdentitySql(
  identityHex: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveReadColumns('user-organization', fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  const id = sqlQuoteIdentityHex(identityHex)
  return `SELECT ${colPart} FROM user_organization WHERE user_identity = '${id}' AND is_active = true`
}

export function selectCasbinRulesInSubjectsSql(
  subjectsListSql: string,
  fieldAccess: FieldAccessContext | undefined,
): string {
  const cols = resolveReadColumns('casbin-rule', fieldAccess)
  const colPart = cols === null ? '*' : cols.join(', ')
  return `SELECT ${colPart} FROM casbin_rule WHERE v0 IN (${subjectsListSql})`
}
