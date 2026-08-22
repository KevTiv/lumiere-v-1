/**
 * @generated from query-resource-row-type.json (lumiere-codegen). Do not edit by hand;
 * re-run `make codegen` and regenerate this file's import/map body instead.
 *
 * Resources without a generated row type (or whose codegen-reported type name no
 * longer resolves — see `STALE_ROW_TYPE_RESOURCES` in lumiere-codegen output) fall
 * back to `Record<string, unknown>` via `QueryRowFor`.
 */
import type {
  AccountAccount,
  AccountAccountType,
  AccountAnalyticAccount,
  AccountAnalyticDistributionModel,
  AccountAnalyticLine,
  AccountAsset,
  AccountAssetDepreciationLine,
  AccountBankStatement,
  AccountBankStatementLine,
  AccountFiscalYear,
  AccountGroup,
  AccountJournal,
  AccountMove,
  AccountMoveLine,
  AccountPayment,
  AccountPaymentTerm,
  AccountPaymentTermLine,
  AccountPeriod,
  AccountReconciliationWidget,
  AccountTax,
  AccountTaxGroup,
  Activity,
  AdjustmentReason,
  AiAgent,
  AiDocumentProcessingJob,
  AiInsight,
  AiSkill,
  AiTeamMember,
  AiTeamMemberSkill,
  AmortizationLine,
  AmortizationSchedule,
  AnalyticsMetric,
  AuditLog,
  AuditRule,
  BankMatchCandidate,
  BarcodeNomenclature,
  BarcodeRule,
  BudgetPost,
  CalendarEvent,
  CartonizationResult,
  CommodityPriceIndex,
  Company,
  ConsignmentAgreement,
  ConsolidationAccount,
  ConsolidationEliminationEntry,
  ConsolidationJournal,
  Contact,
  ContactSegment,
  ContactTag,
  CrossoveredBudget,
  CrossoveredBudgetLines,
  Dashboard,
  DashboardWidget,
  DataClassification,
  DataClassificationRule,
  DeferredRevenueLine,
  DeferredRevenueSchedule,
  DelegatedAdminScope,
  DeliveryCarrier,
  DeliveryPriceRule,
  Document,
  DocumentFolder,
  ExpenseCardStatementLine,
  FieldPermission,
  FinancialReport,
  FleetVehicle,
  FormConfig,
  FormConfigField,
  FormRoleConfig,
  FxRevaluationRun,
  HelpdeskSla,
  HelpdeskStage,
  HelpdeskTeam,
  HelpdeskTicket,
  HrContract,
  HrDepartment,
  HrEmployee,
  HrExpense,
  HrExpenseAdvance,
  HrExpensePolicyException,
  HrExpenseReceipt,
  HrExpenseSheet,
  HrJobPosition,
  HrLeave,
  HrLeaveType,
  HrPayrollStructure,
  HrPayslip,
  HrResource,
  HrSalaryRule,
  ImportJob,
  IntercompanyRule,
  IntercompanyTransaction,
  InventoryAdjustment,
  InventoryException,
  InventoryValuation,
  IoTAction,
  IoTAlert,
  IoTDevice,
  IoTHub,
  IoTPairingToken,
  IoTTelemetry,
  IoTThreshold,
  KnowledgeArticle,
  KnowledgeArticleCategory,
  Lead,
  MailFollower,
  MailMessage,
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpRoutingWorkcenter,
  MrpWorkcenter,
  MrpWorkorder,
  Opportunity,
  OpportunityStage,
  PackagingMaterial,
  PartnerCreditControl,
  PickingWave,
  PosConfig,
  PosLoyaltyCard,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosSession,
  PosTerminal,
  Product,
  ProductCategory,
  ProductPricelist,
  ProductPricelistItem,
  ProjectProject,
  ProjectTask,
  ProjectTimesheet,
  Proposal,
  ProposalAnalysis,
  ProposalBidDecision,
  ProposalClarification,
  ProposalClause,
  ProposalComment,
  ProposalComplianceRequirement,
  ProposalIntegrationIntent,
  ProposalLineItem,
  ProposalPresence,
  ProposalProcurementScore,
  ProposalSection,
  ProposalSourceDoc,
  ProposalTemplate,
  ProposalVersion,
  PurchaseApprovalDelegate,
  PurchaseBlanketOrder,
  PurchaseBlanketOrderLine,
  PurchaseBlanketRelease,
  PurchaseContract,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequisition,
  PurchaseRequisitionLine,
  PurchasingIntegrationIntent,
  QualityAlert,
  QualityCheck,
  ReplenishmentRule,
  ReportTemplate,
  ResPartnerBank,
  ReturnOrder,
  ReturnOrderLine,
  RevenueRecognitionRule,
  Role,
  SaleCommission,
  SaleOrder,
  SaleOrderLine,
  ScheduledReport,
  SerialLotTraceability,
  ShippingMethod,
  SodConflictRule,
  StockCycleCount,
  StockInventory,
  StockLandedCost,
  StockLandedCostLines,
  StockLocation,
  StockMove,
  StockPackage,
  StockPicking,
  StockPickingBatch,
  StockProductionLot,
  StockProductionSerial,
  StockQuant,
  StockRoute,
  StockRule,
  StockTraceabilityReport,
  Subscription,
  SubscriptionBillingRun,
  SubscriptionLine,
  SubscriptionPlan,
  SupplierIntakeRequest,
  TaxDeadline,
  TaxJurisdiction,
  TaxSchedule,
  TrialBalance,
  Uom,
  UserCustomField,
  UserOrganization,
  UserProfile,
  UserRoleAssignment,
  UtmCampaign,
  UtmMedium,
  UtmSource,
  VendorRiskFlag,
  VendorScorecard,
  Warehouse,
  Warehouse3DZone,
  WarehouseGeo,
  WarehouseSyncIntent,
  WarehouseTask,
  Workflow,
  WorkflowInstance,
} from "./types"

export interface QueryRowMap {
  "account-account-types": AccountAccountType
  "account-accounts": AccountAccount
  "account-assets": AccountAsset
  "account-groups": AccountGroup
  "account-journals": AccountJournal
  "account-move-lines": AccountMoveLine
  "account-moves": AccountMove
  "account-payment-term-lines": AccountPaymentTermLine
  "account-payment-terms": AccountPaymentTerm
  "account-payments": AccountPayment
  "account-periods": AccountPeriod
  "account-reconciliation-widgets": AccountReconciliationWidget
  "account-taxes": AccountTax
  "activities": Activity
  "adjustment-reasons": AdjustmentReason
  "ai-agents": AiAgent
  "ai-document-processing-jobs": AiDocumentProcessingJob
  "ai-insights": AiInsight
  "ai-skills": AiSkill
  "ai-team-member-skills": AiTeamMemberSkill
  "ai-team-members": AiTeamMember
  "amortization-lines": AmortizationLine
  "amortization-schedules": AmortizationSchedule
  "analytic-accounts": AccountAnalyticAccount
  "analytic-distribution-models": AccountAnalyticDistributionModel
  "analytic-lines": AccountAnalyticLine
  "analytics-metrics": AnalyticsMetric
  "audit-log": AuditLog
  "audit-rules": AuditRule
  "bank-match-candidates": BankMatchCandidate
  "bank-statement-lines": AccountBankStatementLine
  "bank-statements": AccountBankStatement
  "barcode-nomenclatures": BarcodeNomenclature
  "barcode-rules": BarcodeRule
  "budget-lines": CrossoveredBudgetLines
  "budget-posts": BudgetPost
  "budgets": CrossoveredBudget
  "calendar-events": CalendarEvent
  "cartonization-results": CartonizationResult
  "commodity-price-indexes": CommodityPriceIndex
  "companies": Company
  "consignment-agreements": ConsignmentAgreement
  "consolidation-accounts": ConsolidationAccount
  "consolidation-elimination-entries": ConsolidationEliminationEntry
  "consolidation-journals": ConsolidationJournal
  "contact-segments": ContactSegment
  "contact-tags": ContactTag
  "contacts": Contact
  "contracts": HrContract
  "dashboard-widgets": DashboardWidget
  "dashboards": Dashboard
  "data-classification-rules": DataClassificationRule
  "data-classifications": DataClassification
  "deferred-revenue-lines": DeferredRevenueLine
  "deferred-revenue-schedules": DeferredRevenueSchedule
  "delegated-admin-scopes": DelegatedAdminScope
  "delivery-carriers": DeliveryCarrier
  "delivery-price-rules": DeliveryPriceRule
  "departments": HrDepartment
  "depreciation-lines": AccountAssetDepreciationLine
  "document-folders": DocumentFolder
  "documents": Document
  "employees": HrEmployee
  "expense-advances": HrExpenseAdvance
  "expense-card-statement-unmatched": ExpenseCardStatementLine
  "expense-policy-exceptions": HrExpensePolicyException
  "expense-receipts": HrExpenseReceipt
  "expense-sheets": HrExpenseSheet
  "expenses": HrExpense
  "field-permissions": FieldPermission
  "financial-reports": FinancialReport
  "fiscal-years": AccountFiscalYear
  "fixed-assets": AccountAsset
  "fleet-vehicles": FleetVehicle
  "form-config-fields": FormConfigField
  "form-configs": FormConfig
  "form-role-configs": FormRoleConfig
  "fx-revaluation-runs": FxRevaluationRun
  "helpdesk-slas": HelpdeskSla
  "helpdesk-stages": HelpdeskStage
  "helpdesk-teams": HelpdeskTeam
  "helpdesk-tickets": HelpdeskTicket
  "hr-resources": HrResource
  "import-jobs": ImportJob
  "intercompany-rules": IntercompanyRule
  "intercompany-transactions": IntercompanyTransaction
  "inventory-adjustments": InventoryAdjustment
  "inventory-exceptions": InventoryException
  "inventory-exceptions-expired-lots": InventoryException
  "inventory-exceptions-open-qc": InventoryException
  "inventory-exceptions-short-atp": InventoryException
  "inventory-valuations": InventoryValuation
  "iot-actions": IoTAction
  "iot-alerts": IoTAlert
  "iot-devices": IoTDevice
  "iot-hubs": IoTHub
  "iot-pairing-tokens": IoTPairingToken
  "iot-telemetry": IoTTelemetry
  "iot-thresholds": IoTThreshold
  "job-positions": HrJobPosition
  "knowledge-articles": KnowledgeArticle
  "knowledge-categories": KnowledgeArticleCategory
  "landed-cost-lines": StockLandedCostLines
  "landed-costs": StockLandedCost
  "leads": Lead
  "leave-requests": HrLeave
  "leave-types": HrLeaveType
  "mail-followers": MailFollower
  "mail-messages": MailMessage
  "mrp-bom-lines": MrpBomLine
  "mrp-boms": MrpBom
  "mrp-productions": MrpProduction
  "mrp-routing-workcenters": MrpRoutingWorkcenter
  "mrp-workcenters": MrpWorkcenter
  "mrp-workorders": MrpWorkorder
  "opportunities": Opportunity
  "opportunity-stages": OpportunityStage
  "packaging-materials": PackagingMaterial
  "partner-banks": ResPartnerBank
  "partner-credit-controls": PartnerCreditControl
  "partner-credit-holds": PartnerCreditControl
  "payroll-structures": HrPayrollStructure
  "payslips": HrPayslip
  "picking-batches": StockPickingBatch
  "picking-waves": PickingWave
  "pos-configs": PosConfig
  "pos-loyalty-cards": PosLoyaltyCard
  "pos-loyalty-programs": PosLoyaltyProgram
  "pos-payment-methods": PosPaymentMethod
  "pos-sessions": PosSession
  "pos-terminals": PosTerminal
  "pricelist-items": ProductPricelistItem
  "pricelists": ProductPricelist
  "product-categories": ProductCategory
  "products": Product
  "projects": ProjectProject
  "proposal-analyses": ProposalAnalysis
  "proposal-bid-decisions": ProposalBidDecision
  "proposal-clarifications": ProposalClarification
  "proposal-clauses": ProposalClause
  "proposal-comments": ProposalComment
  "proposal-compliance-requirements": ProposalComplianceRequirement
  "proposal-integration-intents": ProposalIntegrationIntent
  "proposal-line-items": ProposalLineItem
  "proposal-presence": ProposalPresence
  "proposal-procurement-scores": ProposalProcurementScore
  "proposal-sections": ProposalSection
  "proposal-source-docs": ProposalSourceDoc
  "proposal-templates": ProposalTemplate
  "proposal-versions": ProposalVersion
  "proposals": Proposal
  "purchase-approval-delegates": PurchaseApprovalDelegate
  "purchase-blanket-order-lines": PurchaseBlanketOrderLine
  "purchase-blanket-orders": PurchaseBlanketOrder
  "purchase-blanket-releases": PurchaseBlanketRelease
  "purchase-contracts": PurchaseContract
  "purchase-order-lines": PurchaseOrderLine
  "purchase-order-lines-over-billed": PurchaseOrderLine
  "purchase-orders": PurchaseOrder
  "purchase-orders-partial-receipt": PurchaseOrder
  "purchase-orders-to-approve": PurchaseOrder
  "purchase-requisition-lines": PurchaseRequisitionLine
  "purchase-requisitions": PurchaseRequisition
  "purchasing-integration-intents": PurchasingIntegrationIntent
  "quality-alerts": QualityAlert
  "quality-checks": QualityCheck
  "replenishment-rules": ReplenishmentRule
  "report-templates": ReportTemplate
  "return-order-lines": ReturnOrderLine
  "return-orders": ReturnOrder
  "revenue-recognition-rules": RevenueRecognitionRule
  "roles": Role
  "salary-rules": HrSalaryRule
  "sale-commissions": SaleCommission
  "sale-commissions-pending": SaleCommission
  "sale-order-lines": SaleOrderLine
  "sale-orders": SaleOrder
  "sale-orders-to-approve": SaleOrder
  "scheduled-reports": ScheduledReport
  "serial-lot-traceability": SerialLotTraceability
  "shipping-methods": ShippingMethod
  "sod-conflict-rules": SodConflictRule
  "stock-cycle-counts": StockCycleCount
  "stock-inventories": StockInventory
  "stock-locations": StockLocation
  "stock-moves": StockMove
  "stock-packages": StockPackage
  "stock-pickings": StockPicking
  "stock-production-lots": StockProductionLot
  "stock-production-serials": StockProductionSerial
  "stock-quants": StockQuant
  "stock-routes": StockRoute
  "stock-rules": StockRule
  "stock-traceability-reports": StockTraceabilityReport
  "subscription-billing-runs": SubscriptionBillingRun
  "subscription-lines": SubscriptionLine
  "subscription-plans": SubscriptionPlan
  "subscriptions": Subscription
  "supplier-intakes": SupplierIntakeRequest
  "tasks": ProjectTask
  "tax-deadlines": TaxDeadline
  "tax-groups": AccountTaxGroup
  "tax-jurisdictions": TaxJurisdiction
  "tax-schedules": TaxSchedule
  "timesheets": ProjectTimesheet
  "trial-balances": TrialBalance
  "uoms": Uom
  "user-custom-fields": UserCustomField
  "user-organization": UserOrganization
  "user-profile": UserProfile
  "user-role-assignment": UserRoleAssignment
  "user-roles": UserRoleAssignment
  "utm-campaigns": UtmCampaign
  "utm-media": UtmMedium
  "utm-sources": UtmSource
  "vendor-risk-flags": VendorRiskFlag
  "vendor-scorecards": VendorScorecard
  "warehouse-3d-zones": Warehouse3DZone
  "warehouse-geo": WarehouseGeo
  "warehouse-sync-intents": WarehouseSyncIntent
  "warehouse-sync-intents-pending": WarehouseSyncIntent
  "warehouse-tasks": WarehouseTask
  "warehouses": Warehouse
  "workflow-instances": WorkflowInstance
  "workflows": Workflow
}

export type QueryRowResourceKey = keyof QueryRowMap

/**
 * Row type for a query resource. Known resources resolve to their generated
 * row type; anything else (including resources lumiere-codegen has not yet
 * mapped) falls back to `Record<string, unknown>` so existing untyped callers
 * keep compiling while resources migrate incrementally.
 */
export type QueryRowFor<K extends string> = K extends QueryRowResourceKey
  ? QueryRowMap[K]
  : Record<string, unknown>

