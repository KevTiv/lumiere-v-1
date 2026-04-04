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
  AccountAccountType,
  AccountGroup,
  AccountAnalyticAccount,
  AccountAnalyticDistributionModel,
  AccountAnalyticLine,
  AccountAsset,
  AccountBankStatement,
  AccountBankStatementLine,
  AccountJournal,
  AccountReconciliationWidget,
  AccountMove,
  AccountTax,
  CalendarEvent,
  CasbinRule,
  Contact,
  CrossoveredBudget,
  CrossoveredBudgetLines,
  BudgetPost,
  DeliveryCarrier,
  DeliveryPriceRule,
  DeferredRevenueLine,
  DeferredRevenueSchedule,
  Document,
  FleetVehicle,
  FinancialReport,
  HelpdeskSla,
  HelpdeskStage,
  HelpdeskTeam,
  HelpdeskTicket,
  HrContract,
  HrDepartment,
  HrEmployee,
  HrExpense,
  HrJobPosition,
  HrExpenseSheet,
  HrLeave,
  HrLeaveType,
  HrPayrollStructure,
  HrPayslip,
  HrResource,
  HrSalaryRule,
  IoTAction,
  IoTAlert,
  IoTDevice,
  IoTHub,
  IoTPairingToken,
  IoTTelemetry,
  IoTThreshold,
  InventoryAdjustment,
  KnowledgeArticle,
  Lead,
  MailMessage,
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpRoutingWorkcenter,
  MrpWorkcenter,
  MrpWorkorder,
  Opportunity,
  OpportunityStage,
  PosLoyaltyCard,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosTerminal,
  Product,
  ProductCategory,
  ProductPricelist,
  ProductPricelistItem,
  ProposalComment,
  ProposalLineItem,
  ProposalPresence,
  ProposalSection,
  ProposalSourceDoc,
  ProposalVersion,
  ProjectProject,
  ProjectTask,
  ProjectTimesheet,
  Proposal,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequisition,
  ResPartnerBank,
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
  AccountPaymentTerm,
  AccountPaymentTermLine,
  Activity,
  AdjustmentReason,
  AnalyticsMetric,
  BankMatchCandidate,
  BarcodeNomenclature,
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
  SerialLotTraceability,
  ShippingMethod,
  StockLandedCost,
  StockRoute,
  StockRule,
  StockTraceabilityReport,
  SupplierIntakeRequest,
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
  ConsolidationAccount,
  ConsolidationJournal,
  ConsolidationEliminationEntry,
  AccountFiscalYear,
  AccountPeriod,
  AiAgent,
  AiDocumentProcessingJob,
  AiInsight,
  AiTeamMember,
} from './generated/types'

import { sqlFieldNames } from './sql-field-names'

export type QueryResourceKey =
  | 'account-accounts'
  | 'account-account-types'
  | 'account-groups'
  | 'account-journals'
  | 'account-moves'
  | 'account-taxes'
  | 'account-payments'
  | 'account-payment-terms'
  | 'account-payment-term-lines'
  | 'budgets'
  | 'budget-lines'
  | 'budget-posts'
  | 'analytic-accounts'
  | 'analytic-lines'
  | 'analytic-distribution-models'
  | 'bank-statements'
  | 'bank-statement-lines'
  | 'bank-match-candidates'
  | 'account-reconciliation-widgets'
  | 'account-assets'
  | 'consolidation-accounts'
  | 'consolidation-journals'
  | 'consolidation-elimination-entries'
  | 'delivery-carriers'
  | 'delivery-price-rules'
  | 'sale-orders'
  | 'sale-order-lines'
  | 'pricelists'
  | 'pricelist-items'
  | 'picking-batches'
  | 'partner-banks'
  | 'pos-loyalty-cards'
  | 'pos-loyalty-programs'
  | 'pos-payment-methods'
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
  | 'adjustment-reasons'
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
  | 'barcode-nomenclatures'
  | 'serial-lot-traceability'
  | 'stock-traceability-reports'
  | 'inventory-valuations'
  | 'purchase-orders'
  | 'purchase-order-lines'
  | 'purchase-requisitions'
  | 'shipping-methods'
  | 'landed-costs'
  | 'supplier-intakes'
  | 'mrp-productions'
  | 'mrp-boms'
  | 'mrp-bom-lines'
  | 'mrp-workorders'
  | 'mrp-workcenters'
  | 'mrp-routing-workcenters'
  | 'employees'
  | 'departments'
  | 'job-positions'
  | 'leave-requests'
  | 'contracts'
  | 'payslips'
  | 'leave-types'
  | 'payroll-structures'
  | 'salary-rules'
  | 'hr-resources'
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
  | 'proposal-sections'
  | 'proposal-line-items'
  | 'proposal-versions'
  | 'proposal-source-docs'
  | 'proposal-presence'
  | 'proposal-comments'
  | 'calendar-events'
  | 'mail-messages'
  | 'expenses'
  | 'expense-sheets'
  | 'fleet-vehicles'
  | 'pos-terminals'
  | 'roles'
  | 'user-roles'
  | 'user-profile'
  | 'user-role-assignment'
  | 'user-organization'
  | 'casbin-rule'
  | 'iot-devices'
  | 'iot-hubs'
  | 'iot-alerts'
  | 'iot-actions'
  | 'iot-telemetry'
  | 'iot-thresholds'
  | 'iot-pairing-tokens'
  | 'ai-agents'
  | 'ai-team-members'
  | 'ai-insights'
  | 'ai-document-processing-jobs'
  | 'fiscal-years'
  | 'account-periods'

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
  'account-account-types': orgEntry<AccountAccountType>(
    'account_account_type',
    ['account-account-types', 'account_account_type'],
    ['name', 'type', 'internalGroup', 'companyId', 'includeInitialBalance', 'isDeprecated'],
  ),
  'account-groups': orgEntry<AccountGroup>('account_group', ['account-groups', 'account_group'], [
    'name',
    'companyId',
    'level',
    'parentId',
    'codePrefixStart',
    'codePrefixEnd',
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
  'account-payment-terms': orgEntry<AccountPaymentTerm>(
    'account_payment_term',
    ['account-payment-terms', 'account_payment_term'],
    ['name', 'note', 'isActive'],
  ),
  'account-payment-term-lines': entry<AccountPaymentTermLine>(
    'account_payment_term_line',
    ['account-payment-term-lines', 'account_payment_term_line'],
    ['value', 'valueAmount', 'days', 'months', 'daysAfterEndOfMonth', 'sequence'],
    ['id', 'paymentTermId'],
  ),
  budgets: orgEntry<CrossoveredBudget>('crossovered_budget', ['budgets', 'crossovered_budget'], [
    'name', 'companyId', 'state',
  ]),
  'budget-lines': orgEntry<CrossoveredBudgetLines>(
    'crossovered_budget_lines',
    ['budget-lines', 'crossovered_budget_lines'],
    [
      'generalBudgetId',
      'analyticAccountId',
      'plannedAmount',
      'practicalAmount',
      'theoreticalAmount',
      'companyId',
    ],
  ),
  'budget-posts': orgEntry<BudgetPost>('budget_post', ['budget-posts', 'budget_post'], [
    'name',
    'code',
    'companyId',
    'isActive',
    'accountIds',
  ]),
  'analytic-accounts': orgEntry<AccountAnalyticAccount>(
    'account_analytic_account',
    ['analytic-accounts', 'account_analytic_account'],
    ['name', 'code', 'companyId', 'balance'],
  ),
  'analytic-lines': orgEntry<AccountAnalyticLine>('account_analytic_line', ['analytic-lines', 'account_analytic_line'], [
    'name', 'amount', 'accountId', 'companyId', 'date',
  ]),
  'analytic-distribution-models': orgEntry<AccountAnalyticDistributionModel>(
    'account_analytic_distribution_model',
    ['analytic-distribution-models', 'account_analytic_distribution_model'],
    ['name', 'companyId', 'analyticDistribution', 'isActive'],
  ),
  'bank-statements': orgEntry<AccountBankStatement>('account_bank_statement', ['bank-statements', 'account_bank_statement'], [
    'name', 'reference', 'date', 'balanceStart', 'balanceEnd', 'state', 'journalId', 'companyId',
  ]),
  'bank-statement-lines': orgEntry<AccountBankStatementLine>(
    'account_bank_statement_line',
    ['bank-statement-lines', 'account_bank_statement_line'],
    ['amount', 'amountCurrency', 'partnerId', 'statementId', 'journalId', 'isReconciled', 'transactionType', 'accountNumber'],
  ),
  'bank-match-candidates': orgEntry<BankMatchCandidate>('bank_match_candidate', ['bank-match-candidates', 'bank_match_candidate'], [
    'statementLineId', 'matchType', 'entityId', 'amount', 'score', 'ruleId',
  ]),
  'account-reconciliation-widgets': orgEntry<AccountReconciliationWidget>(
    'account_reconciliation_widget',
    ['account-reconciliation-widgets', 'account_reconciliation_widget'],
    ['accountId', 'moveLineIds', 'toCheck', 'mode', 'partnerId', 'companyId'],
  ),
  'account-assets': entry<AccountAsset>(
    'account_asset',
    ['account-assets', 'account_asset'],
    ['name', 'code', 'assetType', 'state', 'acquisitionDate', 'originalValue', 'companyId'],
    ['id', 'companyId'] as readonly (keyof AccountAsset)[],
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
  'delivery-carriers': entry<DeliveryCarrier>(
    'delivery_carrier',
    ['delivery-carriers', 'delivery_carrier'],
    ['name', 'deliveryType', 'active', 'currencyId', 'productId'],
    ['id', 'companyId'] as readonly (keyof DeliveryCarrier)[],
  ),
  'delivery-price-rules': entry<DeliveryPriceRule>(
    'delivery_price_rule',
    ['delivery-price-rules', 'delivery_price_rule'],
    ['variable', 'operator', 'carrierId', 'listPrice'],
    ['id', 'companyId'] as readonly (keyof DeliveryPriceRule)[],
  ),
  'shipping-methods': entry<ShippingMethod>(
    'shipping_method',
    ['shipping-methods', 'shipping_method'],
    ['name', 'provider', 'deliveryType', 'active', 'fixedPrice'],
    ['id', 'companyId'] as readonly (keyof ShippingMethod)[],
  ),
  'pos-payment-methods': entry<PosPaymentMethod>(
    'pos_payment_method',
    ['pos-payment-methods', 'pos_payment_method'],
    ['name', 'paymentMethodType', 'active', 'sequence'],
    ['id', 'companyId'] as readonly (keyof PosPaymentMethod)[],
  ),
  'pos-loyalty-programs': orgEntry<PosLoyaltyProgram>(
    'pos_loyalty_program',
    ['pos-loyalty-programs', 'pos_loyalty_program'],
    ['name', 'currencyId', 'programType', 'isActive'],
  ),
  'pos-loyalty-cards': orgEntry<PosLoyaltyCard>(
    'pos_loyalty_card',
    ['pos-loyalty-cards', 'pos_loyalty_card'],
    ['code', 'points', 'currencyId', 'partnerId', 'isActive'],
  ),
  'partner-banks': orgEntry<ResPartnerBank>('res_partner_bank', ['partner-banks', 'res_partner_bank'], [
    'partnerId',
    'sanitizedAccNumber',
    'accHolderName',
    'active',
    'allowOutPayment',
  ]),
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
  'adjustment-reasons': orgEntry<AdjustmentReason>('adjustment_reason', ['adjustment-reasons', 'adjustment_reason'], [
    'code',
    'description',
    'isActive',
    'isSystem',
  ]),
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
  'barcode-nomenclatures': orgEntry<BarcodeNomenclature>(
    'barcode_nomenclature',
    ['barcode-nomenclatures', 'barcode_nomenclature'],
    ['name', 'description', 'isDefault', 'ruleIds', 'isActive', 'upcEanConv'],
  ),
  'serial-lot-traceability': orgEntry<SerialLotTraceability>(
    'serial_lot_traceability',
    ['serial-lot-traceability', 'serial_lot_traceability'],
    ['productId', 'documentType', 'documentId', 'quantity', 'uomId', 'date', 'serialId', 'lotId', 'moveId'],
  ),
  'stock-traceability-reports': orgEntry<StockTraceabilityReport>(
    'stock_traceability_report',
    ['stock-traceability-reports', 'stock_traceability_report'],
    ['name', 'state', 'dateFrom', 'dateTo', 'productIds', 'lotIds', 'serialIds'],
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
  'landed-costs': orgEntry<StockLandedCost>('stock_landed_cost', ['landed-costs', 'stock_landed_cost'], [
    'state', 'companyId', 'amountTotal', 'currencyId', 'description', 'date',
  ]),
  'supplier-intakes': orgEntry<SupplierIntakeRequest>(
    'supplier_intake_request',
    ['supplier-intakes', 'supplier_intake_request'],
    ['state', 'companyName', 'contactName', 'email', 'phone'],
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
  'mrp-routing-workcenters': orgEntry<MrpRoutingWorkcenter>(
    'mrp_routing_workcenter',
    ['mrp-routing-workcenters', 'mrp_routing_workcenter'],
    ['workcenterId', 'companyId', 'name', 'sequence'],
  ),
  employees: orgEntry<HrEmployee>('hr_employee', ['employees', 'hr_employee'], [
    'name', 'workEmail', 'departmentId', 'companyId',
  ]),
  departments: orgEntry<HrDepartment>('hr_department', ['departments', 'hr_department'], ['name', 'companyId']),
  'job-positions': orgEntry<HrJobPosition>('hr_job_position', ['job-positions', 'hr_job_position'], [
    'name', 'companyId', 'departmentId',
  ]),
  'leave-requests': orgEntry<HrLeave>('hr_leave', ['leave-requests', 'hr_leave'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  contracts: orgEntry<HrContract>('hr_contract', ['contracts', 'hr_contract'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  payslips: orgEntry<HrPayslip>('hr_payslip', ['payslips', 'hr_payslip'], [
    'name', 'employeeId', 'state', 'companyId',
  ]),
  'leave-types': orgEntry<HrLeaveType>('hr_leave_type', ['leave-types', 'hr_leave_type'], [
    'name', 'code', 'allocationType', 'companyId',
  ]),
  'payroll-structures': orgEntry<HrPayrollStructure>(
    'hr_payroll_structure',
    ['payroll-structures', 'hr_payroll_structure'],
    ['name', 'type'],
  ),
  'salary-rules': orgEntry<HrSalaryRule>('hr_salary_rule', ['salary-rules', 'hr_salary_rule'], [
    'name', 'code', 'structureId', 'category',
  ]),
  'hr-resources': orgEntry<HrResource>('hr_resource', ['hr-resources', 'hr_resource'], [
    'name', 'resourceType',
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
  'proposal-sections': orgEntry<ProposalSection>('proposal_section', ['proposal-sections', 'proposal_section'], [
    'title', 'status', 'proposalId', 'sequence', 'wordCount',
  ]),
  'proposal-line-items': orgEntry<ProposalLineItem>('proposal_line_item', ['proposal-line-items', 'proposal_line_item'], [
    'proposalId', 'sectionId', 'productId', 'productName', 'quantity', 'priceUnit', 'subtotal', 'discount',
  ]),
  'proposal-versions': orgEntry<ProposalVersion>('proposal_version', ['proposal-versions', 'proposal_version'], [
    'proposalId', 'versionNumber', 'message', 'authorId',
  ]),
  'proposal-source-docs': orgEntry<ProposalSourceDoc>('proposal_source_doc', ['proposal-source-docs', 'proposal_source_doc'], [
    'proposalId', 'name', 'docType', 'wordCount',
  ]),
  'proposal-presence': orgEntry<ProposalPresence>('proposal_presence', ['proposal-presence', 'proposal_presence'], [
    'proposalId', 'sectionId', 'userName', 'cursorPosition', 'lastSeen',
  ]),
  'proposal-comments': orgEntry<ProposalComment>('proposal_comment', ['proposal-comments', 'proposal_comment'], [
    'proposalId', 'sectionId', 'authorName', 'content', 'isResolved', 'parentId',
  ]),
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
  'fleet-vehicles': orgEntry<FleetVehicle>('fleet_vehicle', ['fleet-vehicles', 'fleet_vehicle'], [
    'name', 'licensePlate', 'driverName', 'status', 'latitude', 'longitude', 'vehicleType', 'companyId',
  ]),
  'pos-terminals': orgEntry<PosTerminal>('pos_terminal', ['pos-terminals', 'pos_terminal'], [
    'name', 'locationLabel', 'status', 'latitude', 'longitude', 'dailyRevenue', 'openOrders', 'companyId',
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
  'iot-devices': orgEntry<IoTDevice>('iot_device', ['iot-devices', 'iot_device'], [
    'name', 'deviceType', 'identifier', 'status', 'hubId', 'workcenterId', 'stockLocationId',
  ]),
  'iot-hubs': orgEntry<IoTHub>('iot_hub', ['iot-hubs', 'iot_hub'], [
    'name', 'serial', 'ipAddress', 'firmwareVersion', 'status', 'lastHeartbeat', 'connectivityQuality',
  ]),
  'iot-alerts': orgEntry<IoTAlert>('iot_alert', ['iot-alerts', 'iot_alert'], [
    'deviceId', 'alertType', 'severity', 'message', 'triggeredAt', 'resolvedAt',
  ]),
  'iot-actions': orgEntry<IoTAction>('iot_action', ['iot-actions', 'iot_action'], [
    'deviceId', 'actionType', 'status', 'triggeredBy', 'createdAt', 'sentAt', 'acknowledgedAt',
  ]),
  'iot-telemetry': orgEntry<IoTTelemetry>('iot_telemetry', ['iot-telemetry', 'iot_telemetry'], [
    'deviceId', 'sensorType', 'value', 'unit', 'quality', 'recordedAt',
  ]),
  'iot-thresholds': orgEntry<IoTThreshold>('iot_threshold', ['iot-thresholds', 'iot_threshold'], [
    'deviceId', 'sensorType', 'minValue', 'maxValue', 'severity', 'active',
  ]),
  'iot-pairing-tokens': entry<IoTPairingToken>(
    'iot_pairing_token',
    ['iot-pairing-tokens', 'iot_pairing_token'],
    ['companyId', 'expiresAt', 'used', 'createdAt'],
    ['organizationId', 'token'],
  ),
  'ai-agents': orgEntry<AiAgent>('ai_agent', ['ai-agents', 'ai_agent'], [
    'name',
    'model',
    'provider',
    'isActive',
    'isDefault',
    'temperature',
    'maxTokens',
    'monthlySpend',
    'monthlyBudget',
    'costPer1KTokens',
  ]),
  'ai-team-members': orgEntry<AiTeamMember>('ai_team_member', ['ai-team-members', 'ai_team_member'], [
    'name',
    'role',
    'aiAgentId',
    'isActive',
    'responseStyle',
  ]),
  'ai-insights': entry<AiInsight>(
    'ai_insight',
    ['ai-insights', 'ai_insight'],
    [
      'title',
      'description',
      'severity',
      'relatedModel',
      'confidence',
      'dismissed',
      'isAcknowledged',
      'generatedAt',
      'tags',
    ],
    ['id', 'companyId'] as readonly (keyof AiInsight)[],
  ),
  'ai-document-processing-jobs': entry<AiDocumentProcessingJob>(
    'ai_document_processing_job',
    ['ai-document-processing-jobs', 'ai_document_processing_job'],
    [
      'documentType',
      'jobType',
      'status',
      'isApproved',
      'confidenceScore',
      'modelUsed',
      'errorMessage',
      'processingCompletedAt',
      'tokensUsed',
      'cost',
    ],
    ['id', 'companyId'] as readonly (keyof AiDocumentProcessingJob)[],
  ),
  'consolidation-accounts': entry<ConsolidationAccount>(
    'consolidation_account',
    ['consolidation-accounts', 'consolidation_account'],
    ['name', 'code', 'accountType', 'isActive', 'isIntercompany'],
    ['id'] as readonly (keyof ConsolidationAccount)[],
  ),
  'consolidation-journals': entry<ConsolidationJournal>(
    'consolidation_journal',
    ['consolidation-journals', 'consolidation_journal'],
    ['name', 'periodName', 'state', 'totalDebit', 'totalCredit'],
    ['id'] as readonly (keyof ConsolidationJournal)[],
  ),
  'consolidation-elimination-entries': entry<ConsolidationEliminationEntry>(
    'consolidation_elimination_entry',
    ['consolidation-elimination-entries', 'consolidation_elimination_entry'],
    ['name', 'accountCode', 'accountName', 'debit', 'credit', 'eliminationType', 'isMatched'],
    ['id', 'journalId'] as readonly (keyof ConsolidationEliminationEntry)[],
  ),
  'fiscal-years': entry<AccountFiscalYear>(
    'account_fiscal_year',
    ['fiscal-years', 'account_fiscal_year'],
    ['name', 'dateFrom', 'dateTo', 'state', 'type', 'isAdjustment', 'companyId'],
    ['id', 'companyId'] as readonly (keyof AccountFiscalYear)[],
  ),
  'account-periods': entry<AccountPeriod>(
    'account_period',
    ['account-periods', 'account_period'],
    ['name', 'code', 'dateFrom', 'dateTo', 'state', 'fiscalYearId', 'isAdjustment', 'companyId'],
    ['id', 'companyId'] as readonly (keyof AccountPeriod)[],
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
