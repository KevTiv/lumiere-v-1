/** @generated from canonical contract IR v2. Do not edit. */
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
  AiReducerAllowlist,
  AiSkill,
  AiTeamMember,
  AiTeamMemberSkill,
  AmortizationLine,
  AmortizationSchedule,
  AnalyticsMetric,
  AssignmentRule,
  AuditLog,
  AuditRule,
  BankMatchCandidate,
  BarcodeNomenclature,
  BarcodeRule,
  BudgetPost,
  CalendarEvent,
  CapacityForecastSnapshot,
  CartonizationResult,
  CommodityPriceIndex,
  Company,
  ConsignmentAgreement,
  ConsolidationAccount,
  ConsolidationEliminationEntry,
  ConsolidationJournal,
  Contact,
  ContactCategory,
  ContactCategoryAssignment,
  ContactCommunicationPreference,
  ContactDuplicateCandidate,
  ContactPhoneIdentity,
  ContactRelationship,
  ContactRelationshipInsight,
  ContactRoleAssignment,
  ContactSegment,
  ContactSegmentRule,
  ContactTag,
  ContactTagAssignment,
  CrmConversation,
  CrmConversationMessage,
  CrmForecastSnapshot,
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
  DocumentTemplate,
  DocumentVersion,
  ExpenseCardStatementLine,
  FieldPermission,
  FinancialReport,
  FleetVehicle,
  FormConfig,
  FormConfigField,
  FormFieldLabel,
  FormRoleConfig,
  FxRevaluationRun,
  HelpdeskSla,
  HelpdeskStage,
  HelpdeskTeam,
  HelpdeskTicket,
  HrApplicant,
  HrAttendance,
  HrBenefitEnrollment,
  HrBenefitPlan,
  HrCapacityForecast,
  HrCompensationEvent,
  HrContract,
  HrDepartment,
  HrEmployee,
  HrEmployeeDocument,
  HrEmployeeSkill,
  HrExpense,
  HrExpenseAdvance,
  HrExpenseMileageRate,
  HrExpensePerDiemRate,
  HrExpensePolicyException,
  HrExpenseReceipt,
  HrExpenseSheet,
  HrGlobalAssignment,
  HrIntegrationIntent,
  HrJobPosition,
  HrLaborCostSnapshot,
  HrLeave,
  HrLeaveType,
  HrOnboardingProgress,
  HrOnboardingTemplate,
  HrOnboardingTemplateItem,
  HrPayrollStructure,
  HrPayslip,
  HrPerformanceCycle,
  HrPerformanceGoal,
  HrPerformanceReview,
  HrResource,
  HrSalaryRule,
  HrShiftOptJob,
  HrSkill,
  HrStatutoryId,
  HrWorkSchedule,
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
  LeadLostReason,
  LeadScore,
  LeadScoreFactor,
  LeadSource,
  MailFollower,
  MailMessage,
  MailTemplate,
  MessageBatch,
  MessageTemplate,
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpRoutingWorkcenter,
  MrpWorkcenter,
  MrpWorkorder,
  OperationalMessage,
  Opportunity,
  OpportunityLine,
  OpportunityPresence,
  OpportunityStage,
  OrgPermission,
  PackagingMaterial,
  PartnerCreditControl,
  PaymentAccount,
  PaymentFee,
  PaymentReconciliation,
  PaymentReversal,
  PaymentTransaction,
  PickingWave,
  PolicySnapshot,
  PosConfig,
  PosLoyaltyCard,
  PosLoyaltyProgram,
  PosPaymentMethod,
  PosSession,
  PosTerminal,
  PrivacyConsent,
  Product,
  ProductCategory,
  ProductPricelist,
  ProductPricelistItem,
  ProjectBaseline,
  ProjectChangeOrder,
  ProjectEarnedValueSnapshot,
  ProjectIntegrationIntent,
  ProjectMarginSnapshot,
  ProjectMilestone,
  ProjectProject,
  ProjectRateCard,
  ProjectRateCardLine,
  ProjectRevenueLine,
  ProjectRevenueSchedule,
  ProjectSubcontractorCost,
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
  PublicHoliday,
  PurchaseApprovalDelegate,
  PurchaseBlanketOrder,
  PurchaseBlanketOrderLine,
  PurchaseBlanketRelease,
  PurchaseContract,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseRequisition,
  PurchaseRequisitionLine,
  PurchaseReturn,
  PurchaseReturnLine,
  PurchaseRfq,
  PurchaseRfqBid,
  PurchaseRfqLine,
  PurchasingIntegrationIntent,
  QualityAlert,
  QualityCheck,
  QualityTeam,
  RecordCustomFieldValue,
  ReplenishmentRule,
  ReportTemplate,
  ResPartnerBank,
  ResourceAllocation,
  ResourceCapacitySnapshot,
  ResourceUtilisationSnapshot,
  ReturnOrder,
  ReturnOrderLine,
  RevenueRecognitionRule,
  Role,
  SaleCommission,
  SaleOrder,
  SaleOrderLine,
  SavedReport,
  ScheduledReport,
  SegmentMember,
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
  SubscriptionAmendment,
  SubscriptionBillingRun,
  SubscriptionBundle,
  SubscriptionBundleItem,
  SubscriptionCollection,
  SubscriptionCommitment,
  SubscriptionEntitlement,
  SubscriptionLine,
  SubscriptionPaymentIntent,
  SubscriptionPlan,
  SubscriptionPriceIndex,
  SubscriptionPriceTier,
  SubscriptionTaxSettleIntent,
  SubscriptionUsageCharge,
  SubscriptionUsageEvent,
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
  WorkflowEdge,
  WorkflowInstance,
  WorkflowNode,
  WorkflowVersion,
  WorkingCalendar,
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
  "ai-reducer-allowlist": AiReducerAllowlist
  "ai-skills": AiSkill
  "ai-team-member-skills": AiTeamMemberSkill
  "ai-team-members": AiTeamMember
  "amortization-lines": AmortizationLine
  "amortization-schedules": AmortizationSchedule
  "analytic-accounts": AccountAnalyticAccount
  "analytic-distribution-models": AccountAnalyticDistributionModel
  "analytic-lines": AccountAnalyticLine
  "analytics-metrics": AnalyticsMetric
  "applicants": HrApplicant
  "assignment-rules": AssignmentRule
  "attendance": HrAttendance
  "audit-log": AuditLog
  "audit-rules": AuditRule
  "auth-role-table": Role
  "bank-match-candidates": BankMatchCandidate
  "bank-statement-lines": AccountBankStatementLine
  "bank-statements": AccountBankStatement
  "barcode-nomenclatures": BarcodeNomenclature
  "barcode-rules": BarcodeRule
  "benefit-enrollments": HrBenefitEnrollment
  "benefit-plans": HrBenefitPlan
  "budget-lines": CrossoveredBudgetLines
  "budget-posts": BudgetPost
  "budgets": CrossoveredBudget
  "calendar-events": CalendarEvent
  "capacity-forecast-by-employee": CapacityForecastSnapshot
  "cartonization-results": CartonizationResult
  "commodity-price-indexes": CommodityPriceIndex
  "companies": Company
  "compensation-events": HrCompensationEvent
  "consignment-agreements": ConsignmentAgreement
  "consolidation-accounts": ConsolidationAccount
  "consolidation-elimination-entries": ConsolidationEliminationEntry
  "consolidation-journals": ConsolidationJournal
  "contact-categories": ContactCategory
  "contact-category-assignments": ContactCategoryAssignment
  "contact-communication-preferences": ContactCommunicationPreference
  "contact-duplicate-candidates": ContactDuplicateCandidate
  "contact-phone-identities": ContactPhoneIdentity
  "contact-relationship-insights": ContactRelationshipInsight
  "contact-relationships": ContactRelationship
  "contact-role-assignments": ContactRoleAssignment
  "contact-segment-rules": ContactSegmentRule
  "contact-segments": ContactSegment
  "contact-tag-assignments": ContactTagAssignment
  "contact-tags": ContactTag
  "contacts": Contact
  "contracts": HrContract
  "crm-conversation-messages": CrmConversationMessage
  "crm-conversations": CrmConversation
  "crm-forecast-snapshots": CrmForecastSnapshot
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
  "direct-reports": HrEmployee
  "document-folders": DocumentFolder
  "document-templates": DocumentTemplate
  "document-versions": DocumentVersion
  "documents": Document
  "documents-deleted": Document
  "employee-documents": HrEmployeeDocument
  "employees": HrEmployee
  "expense-advances": HrExpenseAdvance
  "expense-card-statement-unmatched": ExpenseCardStatementLine
  "expense-mileage-rates": HrExpenseMileageRate
  "expense-per-diem-rates": HrExpensePerDiemRate
  "expense-policy-exceptions": HrExpensePolicyException
  "expense-receipts": HrExpenseReceipt
  "expense-sheets": HrExpenseSheet
  "expense-sheets-to-approve": HrExpenseSheet
  "expenses": HrExpense
  "expenses-missing-receipt": HrExpense
  "field-permissions": FieldPermission
  "financial-reports": FinancialReport
  "fiscal-years": AccountFiscalYear
  "fixed-assets": AccountAsset
  "fleet-vehicles": FleetVehicle
  "form-config-fields": FormConfigField
  "form-configs": FormConfig
  "form-field-labels": FormFieldLabel
  "form-role-configs": FormRoleConfig
  "fx-revaluation-runs": FxRevaluationRun
  "global-assignments": HrGlobalAssignment
  "helpdesk-slas": HelpdeskSla
  "helpdesk-stages": HelpdeskStage
  "helpdesk-teams": HelpdeskTeam
  "helpdesk-tickets": HelpdeskTicket
  "hr-capacity-forecast": HrCapacityForecast
  "hr-employee-skills": HrEmployeeSkill
  "hr-integration-intents": HrIntegrationIntent
  "hr-resources": HrResource
  "hr-skills": HrSkill
  "hr-statutory-ids": HrStatutoryId
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
  "labor-cost-snapshots": HrLaborCostSnapshot
  "landed-cost-lines": StockLandedCostLines
  "landed-costs": StockLandedCost
  "lead-lost-reasons": LeadLostReason
  "lead-score-factors": LeadScoreFactor
  "lead-scores": LeadScore
  "lead-sources": LeadSource
  "leads": Lead
  "leave-requests": HrLeave
  "leave-types": HrLeaveType
  "leaves-to-approve": HrLeave
  "mail-followers": MailFollower
  "mail-messages": MailMessage
  "mail-templates": MailTemplate
  "message-batches": MessageBatch
  "message-templates": MessageTemplate
  "mrp-bom-lines": MrpBomLine
  "mrp-boms": MrpBom
  "mrp-productions": MrpProduction
  "mrp-routing-workcenters": MrpRoutingWorkcenter
  "mrp-workcenters": MrpWorkcenter
  "mrp-workorders": MrpWorkorder
  "my-employee": HrEmployee
  "onboarding-progress": HrOnboardingProgress
  "onboarding-template-items": HrOnboardingTemplateItem
  "onboarding-templates": HrOnboardingTemplate
  "operational-messages": OperationalMessage
  "opportunities": Opportunity
  "opportunity-lines": OpportunityLine
  "opportunity-presence": OpportunityPresence
  "opportunity-stages": OpportunityStage
  "org-permissions": OrgPermission
  "packaging-materials": PackagingMaterial
  "partner-banks": ResPartnerBank
  "partner-credit-controls": PartnerCreditControl
  "partner-credit-holds": PartnerCreditControl
  "payment-accounts": PaymentAccount
  "payment-fees": PaymentFee
  "payment-reconciliations": PaymentReconciliation
  "payment-reversals": PaymentReversal
  "payment-transactions": PaymentTransaction
  "payroll-structures": HrPayrollStructure
  "payslips": HrPayslip
  "payslips-to-export": HrPayslip
  "performance-cycles": HrPerformanceCycle
  "performance-goals": HrPerformanceGoal
  "performance-reviews": HrPerformanceReview
  "picking-batches": StockPickingBatch
  "picking-waves": PickingWave
  "policy-snapshots": PolicySnapshot
  "pos-configs": PosConfig
  "pos-loyalty-cards": PosLoyaltyCard
  "pos-loyalty-programs": PosLoyaltyProgram
  "pos-payment-methods": PosPaymentMethod
  "pos-sessions": PosSession
  "pos-terminals": PosTerminal
  "pricelist-items": ProductPricelistItem
  "pricelists": ProductPricelist
  "privacy-consent": PrivacyConsent
  "product-categories": ProductCategory
  "products": Product
  "project-baselines": ProjectBaseline
  "project-change-orders": ProjectChangeOrder
  "project-earned-value-by-project": ProjectEarnedValueSnapshot
  "project-integration-intents": ProjectIntegrationIntent
  "project-margin-by-project": ProjectMarginSnapshot
  "project-milestones": ProjectMilestone
  "project-rate-card-lines": ProjectRateCardLine
  "project-rate-cards": ProjectRateCard
  "project-revenue-lines": ProjectRevenueLine
  "project-revenue-schedules": ProjectRevenueSchedule
  "project-subcontractor-costs": ProjectSubcontractorCost
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
  "public-holidays": PublicHoliday
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
  "purchase-return-lines": PurchaseReturnLine
  "purchase-returns": PurchaseReturn
  "purchase-rfq-bids": PurchaseRfqBid
  "purchase-rfq-lines": PurchaseRfqLine
  "purchase-rfqs": PurchaseRfq
  "purchasing-integration-intents": PurchasingIntegrationIntent
  "quality-alerts": QualityAlert
  "quality-checks": QualityCheck
  "quality-teams": QualityTeam
  "record-custom-field-values": RecordCustomFieldValue
  "replenishment-rules": ReplenishmentRule
  "report-templates": ReportTemplate
  "resource-allocations": ResourceAllocation
  "resource-capacity-by-employee": ResourceCapacitySnapshot
  "resource-utilisation-by-employee": ResourceUtilisationSnapshot
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
  "saved-reports": SavedReport
  "scheduled-reports": ScheduledReport
  "segment-members": SegmentMember
  "serial-lot-traceability": SerialLotTraceability
  "shift-opt-jobs": HrShiftOptJob
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
  "subscription-amend-pending": SubscriptionCollection
  "subscription-amendments": SubscriptionAmendment
  "subscription-billing-runs": SubscriptionBillingRun
  "subscription-bundle-items": SubscriptionBundleItem
  "subscription-bundles": SubscriptionBundle
  "subscription-collections": SubscriptionCollection
  "subscription-commitments": SubscriptionCommitment
  "subscription-due-to-bill": SubscriptionCollection
  "subscription-entitlements": SubscriptionEntitlement
  "subscription-lines": SubscriptionLine
  "subscription-past-due": SubscriptionCollection
  "subscription-payment-intents": SubscriptionPaymentIntent
  "subscription-plans": SubscriptionPlan
  "subscription-price-indexes": SubscriptionPriceIndex
  "subscription-price-tiers": SubscriptionPriceTier
  "subscription-rating-backlog": SubscriptionUsageEvent
  "subscription-tax-settle-intents": SubscriptionTaxSettleIntent
  "subscription-usage-charges": SubscriptionUsageCharge
  "subscription-usage-events": SubscriptionUsageEvent
  "subscriptions": Subscription
  "supplier-intakes": SupplierIntakeRequest
  "tasks": ProjectTask
  "tax-deadlines": TaxDeadline
  "tax-groups": AccountTaxGroup
  "tax-jurisdictions": TaxJurisdiction
  "tax-schedules": TaxSchedule
  "timesheets": ProjectTimesheet
  "timesheets-to-validate": ProjectTimesheet
  "timesheets-unbilled": ProjectTimesheet
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
  "work-schedules": HrWorkSchedule
  "workflow-edges": WorkflowEdge
  "workflow-instances": WorkflowInstance
  "workflow-nodes": WorkflowNode
  "workflow-versions": WorkflowVersion
  "workflows": Workflow
  "working-calendars": WorkingCalendar
}

export type QueryRowResourceKey = keyof QueryRowMap

export type QueryRowFor<K extends QueryRowResourceKey> = QueryRowMap[K]
