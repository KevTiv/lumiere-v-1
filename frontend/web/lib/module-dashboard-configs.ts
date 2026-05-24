import type { TFunction } from "i18next"
import { chartAccountPrimaryLabel, contactPrimaryLabel, inventoryProductPrimaryLabel, proposalPrimaryLabel, saleOrderPrimaryLabel } from "@lumiere/stdb/read-models"
import type { DashboardConfig, ModuleConfig } from "@lumiere/ui"
import {
  proposalsTableConfig,
  proposalTemplatesTableConfig,
  newProposalForm,
} from "@lumiere/ui"
import {
  buildAccountsTableConfig,
  journalEntriesTableConfig,
  taxesTableConfig,
  budgetsTableConfig,
  analyticAccountsTableConfig,
  newAccountForm,
  newInvoiceForm,
  newBillForm,
  newJournalEntryForm,
  newTaxForm,
  newBudgetForm,
  newFiscalYearForm,
  newAnalyticAccountForm,
  newAnalyticLineForm,
  newAnalyticDistributionModelForm,
  bankStatementsTableConfig,
  reconciliationWidgetsTableConfig,
  newReconciliationWidgetForm,
  fixedAssetsTableConfig,
  accountPaymentsTableConfig,
  paymentTermsTableConfig,
  paymentTermLinesTableConfig,
  newAccountPaymentForm,
  newPaymentTermForm,
  newPaymentTermLineForm,
  analyticLinesTableConfig,
  analyticDistributionModelsTableConfig,
  fiscalYearsTableConfig,
  accountPeriodsTableConfig,
  newAccountPeriodForm,
  intercompanyRulesTableConfig,
  intercompanyTransactionsTableConfig,
  saleOrdersTableConfig,
  saleOrderLinesTableConfig,
  pricelistsTableConfig,
  pricelistItemsTableConfig,
  deliveriesTableConfig,
  deliveryPriceRulesTableConfig,
  deliveryCarriersTableConfig,
  shippingMethodsTableConfig,
  posPaymentMethodsTableConfig,
  posLoyaltyProgramsTableConfig,
  posLoyaltyCardsTableConfig,
  newSaleOrderForm,
  newPricelistForm,
  newPickingBatchForm,
  newDeliveryPriceRuleForm,
  newDeliveryCarrierForm,
  newShippingMethodForm,
  newPosPaymentMethodForm,
  newLoyaltyProgramForm,
  newLoyaltyCardForm,
  leadsTableConfig,
  opportunitiesTableConfig,
  contactsTableConfig,
  newLeadForm,
  newOpportunityForm,
  newContactForm,
  activitiesTableConfig,
  newActivityForm,
  projectsTableConfig,
  tasksTableConfig,
  timesheetsTableConfig,
  newProjectForm,
  newTaskForm,
  productsTableConfig,
  stockQuantsTableConfig,
  transfersTableConfig,
  warehousesTableConfig,
  inventoryAdjustmentsTableConfig,
  newProductForm,
  newWarehouseForm,
  newTransferForm,
  newInventoryAdjustmentForm,
  stockLocationsTableConfig,
  productionLotsTableConfig,
  stockProductionSerialsTableConfig,
  qualityChecksTableConfig,
  cycleCountsTableConfig,
  pickingWavesTableConfig,
  warehouseTasksTableConfig,
  stockRoutesTableConfig,
  stockRulesTableConfig,
  stockMovesTableConfig,
  inventoryValuationsTableConfig,
  replenishmentRulesTableConfig,
  productCategoriesTableConfig,
  barcodeRulesTableConfig,
  adjustmentReasonsTableConfig,
  barcodeNomenclaturesTableConfig,
  traceabilityRecordsTableConfig,
  traceabilityReportsTableConfig,
  newStockLocationForm,
  newStockQuantForm,
  newProductCategoryForm,
  newBarcodeRuleForm,
  newAdjustmentReasonForm,
  newTraceabilityRecordForm,
  newTraceabilityReportForm,
  purchaseOrdersTableConfig,
  purchaseOrderLinesTableConfig,
  purchaseRequisitionsTableConfig,
  newPurchaseOrderForm,
  newPurchaseRequisitionForm,
  vendorsTableConfig,
  partnerBanksTableConfig,
  newPartnerBankForm,
  manufacturingOrdersTableConfig,
  bomsTableConfig,
  bomLinesTableConfig,
  workordersTableConfig,
  workcentersTableConfig,
  routingOperationsTableConfig,
  newManufacturingOrderForm,
  newBomForm,
  newWorkcenterForm,
  employeesTableConfig,
  departmentsTableConfig,
  leaveRequestsTableConfig,
  contractsTableConfig,
  payslipsTableConfig,
  newEmployeeForm,
  newLeaveRequestForm,
  newContractForm,
  newPayslipForm,
  jobPositionsTableConfig,
  newJobPositionForm,
  documentsTableConfig,
  knowledgeArticlesTableConfig,
  documentProcessingJobsTableConfig,
  documentAiInsightsTableConfig,
  newDocumentForm,
  newKnowledgeArticleForm,
  newDocumentProcessingJobForm,
  calendarEventsTableConfig,
  newCalendarEventForm,
  financialReportsTableConfig,
  trialBalancesTableConfig,
  reportTemplatesTableConfig,
  scheduledReportsTableConfig,
  analyticsMetricsTableConfig,
  newFinancialReportForm,
  newReportTemplateForm,
  newScheduledReportForm,
  newAnalyticsMetricForm,
  subscriptionsTableConfig,
  subscriptionPlansTableConfig,
  deferredRevenueSchedulesTableConfig,
  deferredRevenueLinesTableConfig,
  revenueRecognitionRulesTableConfig,
  newSubscriptionForm,
  newSubscriptionPlanForm,
  newDeferredRevenueScheduleForm,
  newRevenueRecognitionRuleForm,
  expensesTableConfig,
  expenseSheetsTableConfig,
  newExpenseForm,
  newExpenseSheetForm,
  helpdeskTicketsTableConfig,
  helpdeskTeamsTableConfig,
  helpdeskStagesTableConfig,
  helpdeskSlasTableConfig,
  newHelpdeskTicketForm,
  newHelpdeskTeamForm,
  newHelpdeskStageForm,
  newHelpdeskSlaForm,
  workflowsTableConfig,
  workflowInstancesTableConfig,
  newWorkflowForm,
  mailMessagesTableConfig,
  newMailMessageForm,
  iotPairingTokensTableConfig,
  iotHubsTableConfig,
  iotDevicesTableConfig,
  iotActionsTableConfig,
  iotTelemetryTableConfig,
  newIotHubForm,
  newIotDeviceForm,
} from "@lumiere/ui"

// ─── Accounting ──────────────────────────────────────────────────────────────

export const accountingDashboard: DashboardConfig = {
  id: "accounting",
  title: "Accounting",
  description: "Financial overview — P&L, cash position, and budget tracking",
  sections: [
    {
      id: "acc-quick-actions-section",
      widgets: [
        {
          id: "acc-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_invoice", label: "New Invoice", icon: "file", color: "blue" },
              { id: "create_bill", label: "New Bill", icon: "download", color: "orange" },
              { id: "journal_entry", label: "Journal Entry", icon: "plus", color: "green" },
              { id: "create_tax", label: "Create Tax", icon: "settings", color: "purple" },
              { id: "currency_rate", label: "Currency rate", icon: "gauge", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "accounting-kpis",
      widgets: [
        {
          id: "acc-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Accounts Receivable", value: "$248,320", change: 12, icon: "TrendingUp" },
              { label: "Accounts Payable", value: "$134,780", change: -5, icon: "TrendingDown" },
              { label: "Cash Balance", value: "$892,450", change: 8, icon: "DollarSign" },
              { label: "Net Revenue MTD", value: "$1,204,300", change: 18, icon: "BarChart2" },
            ],
          },
        },
      ],
    },
    {
      id: "accounting-detail",
      widgets: [
        {
          id: "acc-overdue",
          type: "overdue-invoices",
          title: "Overdue Invoices",
          width: "1/3",
          data: { count: 0, totalAmount: 0, oldestDays: 0 },
        },
        {
          id: "acc-cashflow",
          type: "cash-flow",
          title: "Cash Flow Position",
          width: "1/3",
          data: { arTotal: 0, apTotal: 0, netPosition: 0 },
        },
        {
          id: "acc-budget",
          type: "budget-progress",
          title: "Budget vs Actual",
          width: "1/3",
          data: { budgets: [] },
        },
        {
          id: "acc-balances",
          type: "account-balance",
          title: "Key Account Balances",
          width: "1/2",
          data: { accounts: [] },
        },
        {
          id: "acc-tax-deadlines",
          type: "tax-deadline",
          title: "Tax Deadlines",
          width: "1/2",
          data: { deadlines: [] },
        },
      ],
    },
  ],
}

export const accountingModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "accounting",
  title: "Accounting",
  description: "Financial overview — P&L, cash position, and budget tracking",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: accountingDashboard.sections,
    },
    {
      id: "accounts",
      label: "Chart of Accounts",
      type: "entity",
      entityConfig: buildAccountsTableConfig({
        formatAccountDisplayName: chartAccountPrimaryLabel,
      }),
      createForm: newAccountForm(t),
      createLabel: "New Account",
      createAction: "createAccount",
    },
    {
      id: "journal-entries",
      label: "Journal Entries",
      type: "entity",
      entityConfig: journalEntriesTableConfig,
      createForm: newJournalEntryForm(t),
      createLabel: "New Entry",
      createAction: "createMove",
    },
    {
      id: "invoices",
      label: "Invoices",
      type: "entity",
      entityConfig: journalEntriesTableConfig,
      createForm: newInvoiceForm(t),
      createLabel: "New Invoice",
      createAction: "createInvoice",
    },
    {
      id: "bills",
      label: "Bills",
      type: "entity",
      entityConfig: journalEntriesTableConfig,
      createForm: newBillForm(t),
      createLabel: "New Bill",
      createAction: "createBill",
    },
    {
      id: "taxes",
      label: "Taxes",
      type: "entity",
      entityConfig: taxesTableConfig,
      createForm: newTaxForm(t),
      createLabel: "New Tax",
      createAction: "createTax",
    },
    {
      id: "payments",
      label: t("accounting.tabs.payments"),
      type: "entity",
      entityConfig: accountPaymentsTableConfig(t),
      createForm: newAccountPaymentForm(t),
      createLabel: t("accounting.actions.newPayment"),
      createAction: "createAccountPayment",
    },
    {
      id: "payment-terms",
      label: t("accounting.tabs.paymentTerms"),
      type: "entity",
      entityConfig: paymentTermsTableConfig(t),
      createForm: newPaymentTermForm(t),
      createLabel: t("accounting.actions.newPaymentTerm"),
      createAction: "createPaymentTerm",
    },
    {
      id: "payment-term-lines",
      label: t("accounting.tabs.paymentTermLines"),
      type: "entity",
      entityConfig: paymentTermLinesTableConfig(t),
      createForm: newPaymentTermLineForm(t),
      createLabel: t("accounting.actions.newPaymentTermLine"),
      createAction: "createPaymentTermLine",
    },
    {
      id: "budgets",
      label: "Budgets",
      type: "entity",
      entityConfig: budgetsTableConfig,
      createForm: newBudgetForm(t),
      createLabel: "New Budget",
      createAction: "createBudget",
    },
    {
      id: "analytic",
      label: t("accounting.tabs.analyticAccounts"),
      type: "entity",
      entityConfig: analyticAccountsTableConfig,
      createForm: newAnalyticAccountForm(t),
      createLabel: t("accounting.actions.newAnalyticAccount"),
      createAction: "createAnalyticAccount",
    },
    {
      id: "analytic-lines",
      label: t("accounting.tabs.analyticLines"),
      type: "entity",
      entityConfig: analyticLinesTableConfig(t),
      createForm: newAnalyticLineForm(t),
      createLabel: t("accounting.actions.newAnalyticLine"),
      createAction: "createAnalyticLine",
    },
    {
      id: "analytic-distribution",
      label: t("accounting.tabs.analyticDistribution"),
      type: "entity",
      entityConfig: analyticDistributionModelsTableConfig(t),
      createForm: newAnalyticDistributionModelForm(t),
      createLabel: t("accounting.actions.newAnalyticDistribution"),
      createAction: "createAnalyticDistributionModel",
    },
    {
      id: "bank-statements",
      label: "Bank Statements",
      type: "entity",
      entityConfig: bankStatementsTableConfig(t),
    },
    {
      id: "reconciliation-widgets",
      label: t("accounting.tabs.reconciliationWidgets"),
      type: "entity",
      entityConfig: reconciliationWidgetsTableConfig(t),
      createForm: newReconciliationWidgetForm(t),
      createLabel: t("accounting.actions.newReconciliationWidget"),
      createAction: "createReconciliationWidget",
    },
    {
      id: "fixed-assets",
      label: "Fixed Assets",
      type: "entity",
      entityConfig: fixedAssetsTableConfig(t),
    },
    {
      id: "fiscal-years",
      label: t("accounting.tabs.fiscalYears"),
      type: "entity",
      entityConfig: fiscalYearsTableConfig(t),
      createForm: newFiscalYearForm(t),
      createLabel: t("accounting.actions.newFiscalYear"),
      createAction: "createFiscalYear",
    },
    {
      id: "account-periods",
      label: t("accounting.tabs.accountPeriods"),
      type: "entity",
      entityConfig: accountPeriodsTableConfig(t),
      createForm: newAccountPeriodForm(t),
      createLabel: t("accounting.actions.newAccountPeriod"),
      createAction: "createAccountPeriod",
    },
    {
      id: "consolidation",
      label: t("accounting.consolidation.tabLabel"),
      type: "custom" as const,
    },
    {
      id: "intercompany-rules",
      label: t("accounting.entities.intercompanyRules.title"),
      type: "entity",
      entityConfig: intercompanyRulesTableConfig(t),
    },
    {
      id: "intercompany-transactions",
      label: t("accounting.entities.intercompanyTransactions.title"),
      type: "entity",
      entityConfig: intercompanyTransactionsTableConfig(t),
    },
  ],
})

// ─── Sales ────────────────────────────────────────────────────────────────────

export const salesDashboard: DashboardConfig = {
  id: "sales",
  title: "Sales",
  description: "Revenue performance, pipeline health, and deal activity",
  sections: [
    {
      id: "sales-quick-actions-section",
      widgets: [
        {
          id: "sales-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_sale_order", label: "New Sale Order", icon: "file", color: "blue" },
              { id: "create_pricelist", label: "New Pricelist", icon: "settings", color: "purple" },
              { id: "new_delivery", label: "New Delivery", icon: "package", color: "green" },
              { id: "view_pipeline", label: "View Pipeline", icon: "trending", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "sales-kpis",
      widgets: [
        {
          id: "sales-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Revenue MTD", value: "$1,204,300", change: 18, icon: "TrendingUp" },
              { label: "Orders Closed", value: "84", change: 9, icon: "ShoppingCart" },
              { label: "Avg Deal Size", value: "$14,337", change: 7, icon: "DollarSign" },
              { label: "Win Rate", value: "38%", change: 4, icon: "Target" },
            ],
          },
        },
      ],
    },
    {
      id: "sales-charts",
      title: "Trends",
      widgets: [
        {
          id: "sales-revenue-trend",
          type: "area-chart",
          title: "Monthly Revenue",
          width: "2/3",
          data: {
            xAxisKey: "month",
            series: [
              { name: "Revenue", color: "#6366f1" },
              { name: "Target", color: "#94a3b8" },
            ],
            values: [],
          },
        },
        {
          id: "sales-by-rep",
          type: "metrics",
          title: "Top Sales Reps",
          width: "1/3",
          data: { metrics: [] },
        },
      ],
    },
    {
      id: "sales-breakdown",
      title: "Product Mix",
      widgets: [
        {
          id: "sales-by-product",
          type: "bar-chart",
          title: "Revenue by Product Line",
          width: "full",
          data: {
            categoryKey: "product",
            series: [{ name: "Revenue", color: "#6366f1" }],
            values: [],
          },
        },
      ],
    },
  ],
}

export const salesModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "sales",
  title: "Sales",
  description: "Revenue performance, pipeline health, and deal activity",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: salesDashboard.sections,
    },
    {
      id: "orders",
      label: "Orders",
      type: "entity",
      entityConfig: saleOrdersTableConfig(t, {
        formatSaleOrderDisplayName: saleOrderPrimaryLabel,
      }),
      createForm: newSaleOrderForm(t),
      createLabel: "New Order",
      createAction: "createSaleOrder",
    },
    {
      id: "order-lines",
      label: "Order Lines",
      type: "entity",
      entityConfig: saleOrderLinesTableConfig(t),
    },
    {
      id: "pricelists",
      label: "Pricelists",
      type: "entity",
      entityConfig: pricelistsTableConfig(t),
      createForm: newPricelistForm(t),
      createLabel: "New Pricelist",
      createAction: "createPricelist",
    },
    {
      id: "pricelist-items",
      label: t("sales.pricelistItems.tabLabel"),
      type: "entity",
      entityConfig: pricelistItemsTableConfig(t),
    },
    {
      id: "deliveries",
      label: "Deliveries",
      type: "entity",
      entityConfig: deliveriesTableConfig(t),
      createForm: newPickingBatchForm(t),
      createLabel: t("sales.forms.newPickingBatch.createButton"),
      createAction: "createPickingBatch",
    },
    {
      id: "delivery-price-rules",
      label: t("sales.tabs.deliveryPriceRules"),
      type: "entity",
      entityConfig: deliveryPriceRulesTableConfig(t),
      createForm: newDeliveryPriceRuleForm(t),
      createLabel: t("sales.tabs.createDeliveryPriceRule"),
      createAction: "createDeliveryPriceRule",
    },
    {
      id: "delivery-carriers",
      label: t("sales.tabs.deliveryCarriers"),
      type: "entity",
      entityConfig: deliveryCarriersTableConfig(t),
      createForm: newDeliveryCarrierForm(t),
      createLabel: t("sales.tabs.createDeliveryCarrier"),
      createAction: "createDeliveryCarrier",
    },
    {
      id: "shipping-methods",
      label: t("sales.tabs.shippingMethods"),
      type: "entity",
      entityConfig: shippingMethodsTableConfig(t),
      createForm: newShippingMethodForm(t),
      createLabel: t("sales.tabs.createShippingMethod"),
      createAction: "createShippingMethod",
    },
    {
      id: "pos-payment-methods",
      label: t("sales.tabs.posPaymentMethods"),
      type: "entity",
      entityConfig: posPaymentMethodsTableConfig(t),
      createForm: newPosPaymentMethodForm(t),
      createLabel: t("sales.tabs.createPaymentMethod"),
      createAction: "createPaymentMethod",
    },
    {
      id: "loyalty-programs",
      label: t("sales.tabs.loyaltyPrograms"),
      type: "entity",
      entityConfig: posLoyaltyProgramsTableConfig(t),
      createForm: newLoyaltyProgramForm(t),
      createLabel: t("sales.tabs.createLoyaltyProgram"),
      createAction: "createLoyaltyProgram",
    },
    {
      id: "loyalty-cards",
      label: t("sales.tabs.loyaltyCards"),
      type: "entity",
      entityConfig: posLoyaltyCardsTableConfig(t),
      createForm: newLoyaltyCardForm(t),
      createLabel: t("sales.tabs.createLoyaltyCard"),
      createAction: "createLoyaltyCard",
    },
  ],
})

// ─── CRM ──────────────────────────────────────────────────────────────────────

export const crmDashboard: DashboardConfig = {
  id: "crm",
  title: "CRM",
  description: "Lead pipeline, customer lifecycle, and relationship health",
  sections: [
    {
      id: "crm-quick-actions-section",
      widgets: [
        {
          id: "crm-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_lead", label: "Add Lead", icon: "plus", color: "blue" },
              { id: "create_opportunity", label: "Add Opportunity", icon: "trending", color: "green" },
              { id: "create_contact", label: "Add Contact", icon: "users", color: "teal" },
              { id: "log_activity", label: "Log Activity", icon: "bell", color: "orange" },
            ],
          },
        },
      ],
    },
    {
      id: "crm-kpis",
      widgets: [
        {
          id: "crm-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Active Leads", value: "312", change: 22, icon: "Users" },
              { label: "Pipeline Value", value: "$4,820,000", change: 14, icon: "TrendingUp" },
              { label: "Win Rate", value: "38%", change: 4, icon: "Target" },
              { label: "Churn Rate", value: "2.1%", change: -0.4, icon: "UserMinus" },
            ],
          },
        },
      ],
    },
    {
      id: "crm-pipeline",
      title: "Pipeline",
      widgets: [
        {
          id: "crm-by-stage",
          type: "bar-chart",
          title: "Leads by Stage",
          width: "1/2",
          data: {
            categoryKey: "stage",
            layout: "horizontal",
            series: [{ name: "Count", color: "#6366f1" }],
            values: [],
          },
        },
        {
          id: "crm-pipeline-health",
          type: "metrics",
          title: "Pipeline Health",
          width: "1/2",
          data: { metrics: [] },
        },
      ],
    },
    {
      id: "crm-activity",
      title: "Recent Activity",
      widgets: [
        {
          id: "crm-recent-contacts",
          type: "table",
          title: "Recent Contacts",
          width: "full",
          data: {
            columns: [
              { key: "name", label: "Name" },
              { key: "company", label: "Company" },
              { key: "stage", label: "Stage" },
              { key: "value", label: "Value", align: "right" },
              { key: "lastContact", label: "Last Contact" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

export const crmModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "crm",
  title: "CRM",
  description: "Lead pipeline, customer lifecycle, and relationship health",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: crmDashboard.sections,
    },
    {
      id: "leads",
      label: "Leads",
      type: "entity",
      entityConfig: leadsTableConfig(t),
      createForm: newLeadForm(t),
      createLabel: "New Lead",
      createAction: "createLead",
    },
    {
      id: "opportunities",
      label: "Opportunities",
      type: "entity",
      entityConfig: opportunitiesTableConfig(t),
      createForm: newOpportunityForm(t),
      createLabel: "New Opportunity",
      createAction: "createOpportunity",
    },
    {
      id: "contacts",
      label: "Contacts",
      type: "entity",
      entityConfig: contactsTableConfig(t, {
        formatContactDisplayName: contactPrimaryLabel,
      }),
      createForm: newContactForm(t),
      createLabel: "New Contact",
      createAction: "createContact",
    },
    {
      id: "activities",
      label: "Activities",
      type: "entity",
      entityConfig: activitiesTableConfig(t),
      createForm: newActivityForm(t),
      createLabel: "Log Activity",
      createAction: "createActivity",
    },
  ],
})

// ─── Inventory ────────────────────────────────────────────────────────────────

export const inventoryDashboard: DashboardConfig = {
  id: "inventory",
  title: "Inventory",
  description: "Stock levels, movements, valuations, and reorder alerts",
  sections: [
    {
      id: "inv-quick-actions-section",
      widgets: [
        {
          id: "inv-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_product", label: "Add Product", icon: "package", color: "blue" },
              { id: "create_transfer", label: "New Transfer", icon: "upload", color: "green" },
              { id: "create_adjustment", label: "Adjust Inventory", icon: "refresh", color: "orange" },
              { id: "view_warehouses", label: "View Warehouses", icon: "settings", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "inv-kpis",
      widgets: [
        {
          id: "inv-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Total SKUs", value: "2,847", change: 3, icon: "Package" },
              { label: "Stock Value", value: "$3,240,800", change: -2, icon: "DollarSign" },
              { label: "Low Stock Alerts", value: "47", change: 12, icon: "AlertTriangle" },
              { label: "Inventory Turnover", value: "6.2×", change: 8, icon: "RefreshCw" },
            ],
          },
        },
      ],
    },
    {
      id: "inv-breakdown",
      title: "Stock Distribution",
      widgets: [
        {
          id: "inv-by-category",
          type: "metrics",
          title: "Stock by Category",
          width: "1/2",
          data: { metrics: [] },
        },
        {
          id: "inv-movements",
          type: "bar-chart",
          title: "Stock Movements (Last 7 Days)",
          width: "1/2",
          data: {
            categoryKey: "day",
            series: [
              { name: "In", color: "#22c55e" },
              { name: "Out", color: "#ef4444" },
            ],
            stacked: false,
            values: [],
          },
        },
      ],
    },
    {
      id: "inv-alerts",
      title: "Reorder Alerts",
      widgets: [
        {
          id: "inv-low-stock-table",
          type: "table",
          title: "Low Stock Items",
          width: "full",
          data: {
            columns: [
              { key: "sku", label: "SKU" },
              { key: "name", label: "Product" },
              { key: "qty", label: "Qty On Hand", align: "right" },
              { key: "reorder", label: "Reorder Point", align: "right" },
              { key: "status", label: "Status" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

// ─── Purchasing ───────────────────────────────────────────────────────────────

export const inventoryModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "inventory",
  title: "Inventory",
  description: "Stock levels, movements, valuations, and reorder alerts",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: inventoryDashboard.sections,
    },
    {
      id: "products",
      label: "Products",
      type: "entity",
      entityConfig: productsTableConfig(t, {
        formatProductDisplayName: inventoryProductPrimaryLabel,
      }),
      createForm: newProductForm(t),
      createLabel: "New Product",
      createAction: "createProduct",
    },
    {
      id: "product-categories",
      label: t("inventory.tabs.productCategories"),
      type: "entity",
      entityConfig: productCategoriesTableConfig(t),
      createForm: newProductCategoryForm(t),
      createLabel: t("inventory.forms.newProductCategory.title"),
      createAction: "createProductCategory",
    },
    {
      id: "stock",
      label: "Stock On Hand",
      type: "entity",
      entityConfig: stockQuantsTableConfig(t),
      createForm: newStockQuantForm(t),
      createLabel: t("inventory.forms.newStockQuant.createLabel"),
      createAction: "createStockQuant",
    },
    {
      id: "transfers",
      label: "Transfers",
      type: "entity",
      entityConfig: transfersTableConfig(t),
      createForm: newTransferForm(t),
      createLabel: "New Transfer",
      createAction: "createStockPicking",
    },
    {
      id: "stock-moves",
      label: t("inventory.stockMoves.title"),
      type: "entity",
      entityConfig: stockMovesTableConfig(t),
    },
    {
      id: "warehouses",
      label: "Warehouses",
      type: "entity",
      entityConfig: warehousesTableConfig(t),
      createForm: newWarehouseForm(t),
      createLabel: t("inventory.forms.newWarehouse.title"),
      createAction: "createWarehouse",
    },
    {
      id: "adjustments",
      label: "Adjustments",
      type: "entity",
      entityConfig: inventoryAdjustmentsTableConfig(t),
      createForm: newInventoryAdjustmentForm(t),
      createLabel: "New Adjustment",
      createAction: "createInventoryAdjustment",
    },
    {
      id: "locations",
      label: "Locations",
      type: "entity",
      entityConfig: stockLocationsTableConfig(t),
      createForm: newStockLocationForm(t),
      createLabel: t("inventory.forms.newStockLocation.title"),
      createAction: "createStockLocation",
    },
    {
      id: "lots",
      label: "Lots & Serials",
      type: "entity",
      entityConfig: productionLotsTableConfig(t),
    },
    {
      id: "serials",
      label: t("inventory.productionSerials.tabLabel"),
      type: "entity",
      entityConfig: stockProductionSerialsTableConfig(t),
    },
    {
      id: "quality",
      label: "Quality Checks",
      type: "entity",
      entityConfig: qualityChecksTableConfig(t),
    },
    {
      id: "cycle-counts",
      label: t("inventory.cycleCounts.title"),
      type: "entity",
      entityConfig: cycleCountsTableConfig(t),
    },
    {
      id: "picking-waves",
      label: t("inventory.pickingWaves.title"),
      type: "entity",
      entityConfig: pickingWavesTableConfig(t),
    },
    {
      id: "warehouse-tasks",
      label: t("inventory.warehouseTasks.title"),
      type: "entity",
      entityConfig: warehouseTasksTableConfig(t),
    },
    {
      id: "routes",
      label: t("inventory.stockRoutes.title"),
      type: "entity",
      entityConfig: stockRoutesTableConfig(t),
    },
    {
      id: "rules",
      label: t("inventory.stockRules.title"),
      type: "entity",
      entityConfig: stockRulesTableConfig(t),
    },
    {
      id: "valuations",
      label: t("inventory.inventoryValuations.title"),
      type: "entity",
      entityConfig: inventoryValuationsTableConfig(t),
    },
    {
      id: "replenishment",
      label: t("inventory.replenishmentRules.title"),
      type: "entity",
      entityConfig: replenishmentRulesTableConfig(t),
    },
    {
      id: "barcode-rules",
      label: t("inventory.tabs.barcodeRules"),
      type: "entity",
      entityConfig: barcodeRulesTableConfig(t),
      createForm: newBarcodeRuleForm(t),
      createLabel: t("inventory.forms.newBarcodeRule.title"),
      createAction: "createBarcodeRule",
    },
    {
      id: "barcode-nomenclatures",
      label: t("inventory.tabs.barcodeNomenclatures"),
      type: "entity",
      entityConfig: barcodeNomenclaturesTableConfig(t),
    },
    {
      id: "adjustment-reasons",
      label: t("inventory.tabs.adjustmentReasons"),
      type: "entity",
      entityConfig: adjustmentReasonsTableConfig(t),
      createForm: newAdjustmentReasonForm(t),
      createLabel: t("inventory.forms.newAdjustmentReason.submitLabel"),
      createAction: "createAdjustmentReason",
    },
    {
      id: "traceability-records",
      label: t("inventory.tabs.traceabilityRecords"),
      type: "entity",
      entityConfig: traceabilityRecordsTableConfig(t),
      createForm: newTraceabilityRecordForm(t),
      createLabel: t("inventory.forms.newTraceabilityRecord.submitLabel"),
      createAction: "createTraceabilityRecord",
    },
    {
      id: "traceability-reports",
      label: t("inventory.tabs.traceabilityReports"),
      type: "entity",
      entityConfig: traceabilityReportsTableConfig(t),
      createForm: newTraceabilityReportForm(t),
      createLabel: t("inventory.forms.newTraceabilityReport.submitLabel"),
      createAction: "createTraceabilityReport",
    },
  ],
})

export const purchasingDashboard: DashboardConfig = {
  id: "purchasing",
  title: "Purchasing",
  description: "Purchase orders, vendor performance, and spend analysis",
  sections: [
    {
      id: "pur-quick-actions-section",
      widgets: [
        {
          id: "pur-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_purchase_order", label: "New Purchase Order", icon: "file", color: "blue" },
              { id: "create_requisition", label: "New Requisition", icon: "plus", color: "orange" },
              { id: "receive_goods", label: "Receive Goods", icon: "download", color: "green" },
              { id: "view_vendors", label: "View Vendors", icon: "users", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "pur-kpis",
      widgets: [
        {
          id: "pur-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Open POs", value: "38", change: -6, icon: "FileText" },
              { label: "Spend MTD", value: "$428,700", change: 11, icon: "DollarSign" },
              { label: "Active Vendors", value: "124", change: 2, icon: "Building" },
              { label: "Avg Lead Time", value: "8.4 days", change: -5, icon: "Clock" },
            ],
          },
        },
      ],
    },
    {
      id: "pur-vendors",
      title: "Vendor Spend",
      widgets: [
        {
          id: "pur-by-vendor",
          type: "bar-chart",
          title: "Top Vendors by Spend",
          width: "2/3",
          data: {
            categoryKey: "vendor",
            layout: "horizontal",
            series: [{ name: "Spend", color: "#6366f1" }],
            values: [],
          },
        },
        {
          id: "pur-on-time",
          type: "metrics",
          title: "Vendor On-Time Delivery",
          width: "1/3",
          data: { metrics: [] },
        },
      ],
    },
    {
      id: "pur-pending",
      title: "Pending Orders",
      widgets: [
        {
          id: "pur-po-table",
          type: "table",
          title: "Open Purchase Orders",
          width: "full",
          data: {
            columns: [
              { key: "po", label: "PO #" },
              { key: "vendor", label: "Vendor" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "ordered", label: "Ordered" },
              { key: "expected", label: "Expected" },
              { key: "status", label: "Status" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

export const purchasingModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "purchasing",
  title: "Purchasing",
  description: "Purchase orders, vendor performance, and spend analysis",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: purchasingDashboard.sections,
    },
    {
      id: "orders",
      label: "Purchase Orders",
      type: "entity",
      entityConfig: purchaseOrdersTableConfig(t),
      createForm: newPurchaseOrderForm(t),
      createLabel: "New Order",
      createAction: "createPurchaseOrder",
    },
    {
      id: "lines",
      label: "Order Lines",
      type: "entity",
      entityConfig: purchaseOrderLinesTableConfig(t),
    },
    {
      id: "requisitions",
      label: "Purchase Agreements",
      type: "entity",
      entityConfig: purchaseRequisitionsTableConfig(t),
      createForm: newPurchaseRequisitionForm(t),
      createLabel: "New Agreement",
      createAction: "createPurchaseRequisition",
    },
    {
      id: "vendors",
      label: "Vendors",
      type: "entity",
      entityConfig: vendorsTableConfig(t),
    },
    {
      id: "partner-banks",
      label: t("purchasing.tabs.partnerBanks"),
      type: "entity",
      entityConfig: partnerBanksTableConfig(t),
      createForm: newPartnerBankForm(t),
      createLabel: t("purchasing.tabs.createPartnerBank"),
      createAction: "createPartnerBank",
    },
  ],
})

// ─── HR ───────────────────────────────────────────────────────────────────────

export const hrDashboard: DashboardConfig = {
  id: "hr",
  title: "HR & People",
  description: "Workforce overview, recruitment, attendance, and performance",
  sections: [
    {
      id: "hr-quick-actions-section",
      widgets: [
        {
          id: "hr-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_employee", label: "Add Employee", icon: "users", color: "blue" },
              { id: "create_leave", label: "Request Leave", icon: "plus", color: "green" },
              { id: "create_contract", label: "New Contract", icon: "file", color: "orange" },
              { id: "create_payslip", label: "Generate Payslip", icon: "download", color: "purple" },
            ],
          },
        },
      ],
    },
    {
      id: "hr-kpis",
      widgets: [
        {
          id: "hr-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Total Headcount", value: "247", change: 3, icon: "Users" },
              { label: "Open Positions", value: "18", change: 6, icon: "UserPlus" },
              { label: "Turnover Rate", value: "8.4%", change: -1.2, icon: "UserMinus" },
              { label: "Satisfaction Score", value: "4.2/5", change: 5, icon: "Star" },
            ],
          },
        },
      ],
    },
    {
      id: "hr-workforce",
      title: "Workforce Distribution",
      widgets: [
        {
          id: "hr-by-department",
          type: "bar-chart",
          title: "Headcount by Department",
          width: "1/2",
          data: {
            categoryKey: "dept",
            series: [{ name: "Employees", color: "#6366f1" }],
            values: [],
          },
        },
        {
          id: "hr-leave-usage",
          type: "metrics",
          title: "Leave Balance Usage",
          width: "1/2",
          data: { metrics: [] },
        },
      ],
    },
    {
      id: "hr-hiring",
      title: "Active Recruitment",
      widgets: [
        {
          id: "hr-open-roles",
          type: "table",
          title: "Open Positions",
          width: "full",
          data: {
            columns: [
              { key: "role", label: "Role" },
              { key: "dept", label: "Department" },
              { key: "candidates", label: "Candidates", align: "right" },
              { key: "stage", label: "Stage" },
              { key: "posted", label: "Posted" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

export const hrModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "hr",
  title: "HR & People",
  description: "Workforce overview, recruitment, attendance, and performance",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: hrDashboard.sections,
    },
    {
      id: "employees",
      label: "Employees",
      type: "entity",
      entityConfig: employeesTableConfig(t),
      createForm: newEmployeeForm(t),
      createLabel: "New Employee",
      createAction: "createEmployee",
    },
    {
      id: "departments",
      label: "Departments",
      type: "entity",
      entityConfig: departmentsTableConfig(t),
    },
    {
      id: "leaves",
      label: "Leave Requests",
      type: "entity",
      entityConfig: leaveRequestsTableConfig(t),
      createForm: newLeaveRequestForm(t),
      createLabel: "New Request",
      createAction: "createLeaveRequest",
    },
    {
      id: "contracts",
      label: "Contracts",
      type: "entity",
      entityConfig: contractsTableConfig(t),
      createForm: newContractForm(t),
      createLabel: "New Contract",
      createAction: "createContract",
    },
    {
      id: "payslips",
      label: "Payslips",
      type: "entity",
      entityConfig: payslipsTableConfig(t),
      createForm: newPayslipForm(t),
      createLabel: "New Payslip",
      createAction: "createPayslip",
    },
    {
      id: "job-positions",
      label: "Job Positions",
      type: "entity",
      entityConfig: jobPositionsTableConfig(t),
      createForm: newJobPositionForm(t),
      createLabel: "New Position",
      createAction: "createJobPosition",
    },
  ],
})

// ─── Manufacturing ────────────────────────────────────────────────────────────

export const manufacturingDashboard: DashboardConfig = {
  id: "manufacturing",
  title: "Manufacturing",
  description: "Production orders, work center utilization, and quality metrics",
  sections: [
    {
      id: "mfg-quick-actions-section",
      widgets: [
        {
          id: "mfg-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_mo", label: "New Mfg Order", icon: "settings", color: "blue" },
              { id: "create_bom", label: "New BOM", icon: "file", color: "green" },
              { id: "create_workcenter", label: "New Work Center", icon: "trending", color: "purple" },
              { id: "schedule_production", label: "Schedule Production", icon: "refresh", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "mfg-kpis",
      widgets: [
        {
          id: "mfg-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Active Orders", value: "63", change: 8, icon: "Factory" },
              { label: "On-Time Rate", value: "91%", change: 3, icon: "CheckCircle" },
              { label: "OEE Efficiency", value: "78%", change: -2, icon: "Settings" },
              { label: "Scrap Rate", value: "1.8%", change: -0.4, icon: "Trash2" },
            ],
          },
        },
      ],
    },
    {
      id: "mfg-output",
      title: "Production Output",
      widgets: [
        {
          id: "mfg-output-trend",
          type: "area-chart",
          title: "Weekly Production Output",
          width: "2/3",
          data: {
            xAxisKey: "week",
            series: [
              { name: "Planned", color: "#94a3b8" },
              { name: "Actual", color: "#6366f1" },
            ],
            values: [],
          },
        },
        {
          id: "mfg-work-centers",
          type: "metrics",
          title: "Work Center Utilization",
          width: "1/3",
          data: { metrics: [] },
        },
      ],
    },
    {
      id: "mfg-orders",
      title: "Active Orders",
      widgets: [
        {
          id: "mfg-orders-table",
          type: "table",
          title: "Production Orders",
          width: "full",
          data: {
            columns: [
              { key: "ref", label: "Order" },
              { key: "product", label: "Product" },
              { key: "qty", label: "Qty", align: "right" },
              { key: "progress", label: "Progress", align: "right" },
              { key: "due", label: "Due Date" },
              { key: "status", label: "Status" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

export const manufacturingModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "manufacturing",
  title: "Manufacturing",
  description: "Production orders, work center utilization, and quality metrics",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: manufacturingDashboard.sections,
    },
    {
      id: "orders",
      label: "Manufacturing Orders",
      type: "entity",
      entityConfig: manufacturingOrdersTableConfig(t),
      createForm: newManufacturingOrderForm(t),
      createLabel: "New Order",
      createAction: "createManufacturingOrder",
    },
    {
      id: "boms",
      label: "Bills of Materials",
      type: "entity",
      entityConfig: bomsTableConfig(t),
      createForm: newBomForm(t),
      createLabel: "New BOM",
      createAction: "createBom",
    },
    {
      id: "bom-lines",
      label: t("manufacturing.bomLines.tabLabel"),
      type: "entity",
      entityConfig: bomLinesTableConfig(t),
    },
    {
      id: "workorders",
      label: "Work Orders",
      type: "entity",
      entityConfig: workordersTableConfig(t),
    },
    {
      id: "workcenters",
      label: "Work Centers",
      type: "entity",
      entityConfig: workcentersTableConfig(t),
      createForm: newWorkcenterForm(t),
      createLabel: "New Work Center",
      createAction: "createWorkcenter",
    },
    {
      id: "routing-operations",
      label: t("manufacturing.routingOperations.tabLabel"),
      type: "entity",
      entityConfig: routingOperationsTableConfig(t),
    },
    {
      id: "quality",
      label: "Quality Checks",
      type: "entity",
      entityConfig: qualityChecksTableConfig(t),
    },
  ],
})

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projectsDashboard: DashboardConfig = {
  id: "projects",
  title: "Projects",
  description: "Project portfolio, milestones, team utilization, and budget health",
  sections: [
    {
      id: "proj-quick-actions-section",
      widgets: [
        {
          id: "proj-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 4,
            actions: [
              { id: "create_project", label: "New Project", icon: "file", color: "blue" },
              { id: "create_task", label: "New Task", icon: "plus", color: "green" },
              { id: "log_time", label: "Log Time", icon: "refresh", color: "orange" },
              { id: "view_timesheets", label: "View Timesheets", icon: "trending", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "proj-kpis",
      widgets: [
        {
          id: "proj-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Active Projects", value: "24", change: 2, icon: "FolderKanban" },
              { label: "On Schedule", value: "17 / 24", change: 0, icon: "Clock" },
              { label: "Over Budget", value: "3", change: 1, icon: "AlertCircle" },
              { label: "Billable Hours MTD", value: "1,840h", change: 6, icon: "Clock" },
            ],
          },
        },
      ],
    },
    {
      id: "proj-progress",
      title: "Portfolio Health",
      widgets: [
        {
          id: "proj-progress-bars",
          type: "metrics",
          title: "Project Progress",
          width: "1/2",
          data: { metrics: [] },
        },
        {
          id: "proj-budget-health",
          type: "bar-chart",
          title: "Budget vs Spent",
          width: "1/2",
          data: {
            categoryKey: "project",
            series: [
              { name: "Budget", color: "#94a3b8" },
              { name: "Spent", color: "#6366f1" },
            ],
            values: [],
          },
        },
      ],
    },
    {
      id: "proj-milestones",
      title: "Upcoming Milestones",
      widgets: [
        {
          id: "proj-milestones-table",
          type: "table",
          title: "Next 14 Days",
          width: "full",
          data: {
            columns: [
              { key: "milestone", label: "Milestone" },
              { key: "project", label: "Project" },
              { key: "owner", label: "Owner" },
              { key: "due", label: "Due" },
              { key: "status", label: "Status" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

export const projectsModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "projects",
  title: "Projects",
  description: "Project portfolio, milestones, team utilization, and budget health",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: projectsDashboard.sections,
    },
    {
      id: "projects",
      label: "Projects",
      type: "entity",
      entityConfig: projectsTableConfig(t),
      createForm: newProjectForm(t),
      createLabel: "New Project",
      createAction: "createProject",
    },
    {
      id: "tasks",
      label: "Tasks",
      type: "entity",
      entityConfig: tasksTableConfig(t),
      createForm: newTaskForm(t),
      createLabel: "New Task",
      createAction: "createTask",
    },
    {
      id: "timesheets",
      label: "Timesheets",
      type: "entity",
      entityConfig: timesheetsTableConfig(t),
    },
    {
      id: "resources",
      label: "Resources",
      type: "entity",
      entityConfig: employeesTableConfig(t),
    },
  ],
})

// ─── IoT ──────────────────────────────────────────────────────────────────────

export const iotDashboard: DashboardConfig = {
  id: "iot",
  title: "IoT",
  description: "Connected devices, sensor streams, alerts, and hub status",
  sections: [
    {
      id: "iot-quick-actions-section",
      widgets: [
        {
          id: "iot-quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          width: "full",
          data: {
            columns: 3,
            actions: [
              {
                id: "generate_pairing_token",
                label: "Generate pairing token",
                icon: "refresh",
                color: "blue",
              },
              { id: "register_hub", label: "Register hub", icon: "plus", color: "green" },
              { id: "register_device", label: "Register device", icon: "package", color: "purple" },
              { id: "claim_hub_dev", label: "Claim hub (dev)", icon: "settings", color: "orange" },
              { id: "sync_devices_dev", label: "Sync devices (dev)", icon: "template", color: "teal" },
            ],
          },
        },
      ],
    },
    {
      id: "iot-kpis",
      widgets: [
        {
          id: "iot-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Total Devices", value: "0", icon: "Cpu" },
              { label: "Hubs", value: "0", icon: "Wifi" },
              { label: "Pending actions", value: "0", icon: "Bell" },
              { label: "Pairing tokens (unused)", value: "0", icon: "Activity" },
            ],
          },
        },
      ],
    },
    {
      id: "iot-activity",
      title: "Activity",
      widgets: [
        {
          id: "iot-events-trend",
          type: "area-chart",
          title: "Events (Last 24h)",
          width: "2/3",
          data: {
            xAxisKey: "time",
            series: [
              { name: "Events", color: "#6366f1" },
              { name: "Alerts", color: "#ef4444" },
            ],
            values: [],
          },
        },
        {
          id: "iot-hub-status",
          type: "metrics",
          title: "Hub Connectivity",
          width: "1/3",
          data: { metrics: [] },
        },
      ],
    },
    {
      id: "iot-alerts",
      title: "Active Alerts",
      widgets: [
        {
          id: "iot-alerts-table",
          type: "table",
          title: "Recent Alerts",
          width: "full",
          data: {
            columns: [
              { key: "device", label: "Device" },
              { key: "hub", label: "Hub" },
              { key: "type", label: "Type" },
              { key: "message", label: "Message" },
              { key: "time", label: "Time" },
              { key: "severity", label: "Severity" },
            ],
            rows: [],
          },
        },
      ],
    },
  ],
}

export const iotModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "iot",
  title: t("iot.title"),
  description: t("iot.description"),
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: t("iot.tabs.dashboard"),
      type: "dashboard",
      sections: iotDashboard.sections,
    },
    {
      id: "iot-pairing-tokens",
      label: t("iot.tabs.pairing"),
      type: "entity",
      entityConfig: iotPairingTokensTableConfig(t),
    },
    {
      id: "iot-hubs",
      label: t("iot.tabs.hubs"),
      type: "entity",
      entityConfig: iotHubsTableConfig(t),
      createForm: newIotHubForm(t),
      createLabel: t("iot.hubs.registerManual"),
      createAction: "registerIotHub",
    },
    {
      id: "iot-devices",
      label: t("iot.tabs.devices"),
      type: "entity",
      entityConfig: iotDevicesTableConfig(t),
      createForm: newIotDeviceForm(t),
      createLabel: t("iot.devices.register"),
      createAction: "registerIotDevice",
    },
    {
      id: "iot-actions",
      label: t("iot.tabs.actions"),
      type: "entity",
      entityConfig: iotActionsTableConfig(t),
    },
    {
      id: "iot-telemetry",
      label: t("iot.tabs.telemetry"),
      type: "entity",
      entityConfig: iotTelemetryTableConfig(t),
    },
  ],
})

// ─── Documents ────────────────────────────────────────────────────────────────

export const documentsModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "documents",
  title: "Documents",
  description: "Files, knowledge base, and document management",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "docs-quick-actions-section",
          widgets: [
            {
              id: "docs-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: 2,
                actions: [
                  { id: "upload_document", label: "Upload Document", icon: "upload", color: "blue" },
                  { id: "create_article", label: "New Article", icon: "plus", color: "green" },
                ],
              },
            },
          ],
        },
        {
          id: "docs-kpis",
          widgets: [
            {
              id: "docs-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Total Documents", value: "0", icon: "FileText" },
                  { label: "Shared", value: "0", icon: "Share2" },
                  { label: "Favorites", value: "0", icon: "Star" },
                  { label: "Articles", value: "0", icon: "BookOpen" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "documents",
      label: "Documents",
      type: "entity",
      entityConfig: documentsTableConfig(t),
      createForm: newDocumentForm(t),
      createLabel: "Upload Document",
      createAction: "uploadDocument",
    },
    {
      id: "knowledge-base",
      label: "Knowledge Base",
      type: "entity",
      entityConfig: knowledgeArticlesTableConfig(t),
      createForm: newKnowledgeArticleForm(t),
      createLabel: "New Article",
      createAction: "createArticle",
    },
    {
      id: "document-processing",
      label: t("documents.tabs.processing"),
      type: "entity",
      entityConfig: documentProcessingJobsTableConfig(t),
      createForm: newDocumentProcessingJobForm(t),
      createLabel: t("documents.processing.newJob"),
      createAction: "createDocumentProcessingJob",
    },
    {
      id: "document-insights",
      label: t("documents.tabs.insights"),
      type: "entity",
      entityConfig: documentAiInsightsTableConfig(t),
    },
  ],
})

// ─── Calendar ─────────────────────────────────────────────────────────────────

export const calendarModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "calendar",
  title: "Calendar",
  description: "Meetings, appointments, and scheduled events",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        // {
        //   id: "cal-quick-actions-section",
        //   widgets: [
        //     {
        //       id: "cal-quick-actions",
        //       type: "quick-actions",
        //       title: "Quick Actions",
        //       width: "full",
        //       data: {
        //         columns: 3,
        //         actions: [
        //           { id: "new_event", label: "New Event", icon: "plus", color: "blue" },
        //         ],
        //       },
        //     },
        //   ],
        // },
        {
          id: "cal-kpis",
          widgets: [
            {
              id: "cal-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Events Today", value: "0", icon: "Calendar" },
                  { label: "Upcoming", value: "0", icon: "Clock" },
                  { label: "Recurring", value: "0", icon: "RefreshCw" },
                  { label: "Total Events", value: "0", icon: "CalendarDays" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "calendar",
      label: "Calendar",
      type: "entity",
      entityConfig: calendarEventsTableConfig(t),
    },
    {
      id: "events",
      label: "Events",
      type: "entity",
      entityConfig: calendarEventsTableConfig(t),
      createForm: newCalendarEventForm(t),
      createLabel: "New Event",
      createAction: "createEvent",
    },
  ],
})

// ─── Reports ──────────────────────────────────────────────────────────────────

export const reportsModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "reports",
  title: t("reports.moduleTitle"),
  description: t("reports.moduleDescription"),
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: t("reports.tabs.dashboard"),
      type: "dashboard",
      sections: [
        {
          id: "rep-quick-actions-section",
          widgets: [
            {
              id: "rep-quick-actions",
              type: "quick-actions",
              title: t("reports.dashboard.quickActionsTitle"),
              width: "full",
              data: {
                columns: 6,
                actions: [
                  {
                    id: "generate_report",
                    label: t("reports.dashboard.quickActions.generate"),
                    icon: "plus",
                    color: "purple",
                  },
                  {
                    id: "new_template",
                    label: t("reports.dashboard.quickActions.newTemplate"),
                    icon: "template",
                    color: "blue",
                  },
                  {
                    id: "schedule_report",
                    label: t("reports.dashboard.quickActions.scheduleReport"),
                    icon: "calendar",
                    color: "teal",
                  },
                  {
                    id: "new_metric",
                    label: t("reports.dashboard.quickActions.newMetric"),
                    icon: "gauge",
                    color: "orange",
                  },
                  {
                    id: "new_dashboard",
                    label: t("reports.dashboard.quickActions.newDashboard"),
                    icon: "layout",
                    color: "green",
                  },
                  {
                    id: "new_widget",
                    label: t("reports.dashboard.quickActions.newWidget"),
                    icon: "widget",
                    color: "purple",
                  },
                ],
              },
            },
          ],
        },
        {
          id: "rep-kpis",
          widgets: [
            {
              id: "rep-stat-cards",
              type: "stat-cards",
              title: t("reports.dashboard.kpiTitle"),
              width: "full",
              data: {
                stats: [
                  { label: t("reports.dashboard.kpis.totalReports"), value: "0", icon: "BarChart2" },
                  { label: t("reports.dashboard.kpis.generated"), value: "0", icon: "CheckCircle" },
                  { label: t("reports.dashboard.kpis.exported"), value: "0", icon: "Download" },
                  { label: t("reports.dashboard.kpis.trialLines"), value: "0", icon: "Scale" },
                  { label: t("reports.dashboard.kpis.templates"), value: "0", icon: "template" },
                  { label: t("reports.dashboard.kpis.scheduled"), value: "0", icon: "Calendar" },
                  { label: t("reports.dashboard.kpis.metrics"), value: "0", icon: "gauge" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "reports",
      label: t("reports.tabs.financialReports"),
      type: "entity",
      entityConfig: financialReportsTableConfig(t),
      createForm: newFinancialReportForm(t),
      createLabel: t("reports.createButton.generateReport"),
      createAction: "generateReport",
    },
    {
      id: "trial-balance",
      label: t("reports.tabs.trialBalance"),
      type: "entity",
      entityConfig: trialBalancesTableConfig(t),
    },
    {
      id: "report-templates",
      label: t("reports.tabs.reportTemplates"),
      type: "entity",
      entityConfig: reportTemplatesTableConfig(t),
      createForm: newReportTemplateForm(t),
      createLabel: t("reports.createButton.newTemplate"),
      createAction: "createReportTemplate",
    },
    {
      id: "scheduled-reports",
      label: t("reports.tabs.scheduledReports"),
      type: "entity",
      entityConfig: scheduledReportsTableConfig(t),
      createForm: newScheduledReportForm(t),
      createLabel: t("reports.createButton.scheduleReport"),
      createAction: "createScheduledReport",
    },
    {
      id: "analytics-metrics",
      label: t("reports.tabs.analyticsMetrics"),
      type: "entity",
      entityConfig: analyticsMetricsTableConfig(t),
      createForm: newAnalyticsMetricForm(t),
      createLabel: t("reports.createButton.newMetric"),
      createAction: "createAnalyticsMetric",
    },
  ],
})

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptionsModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "subscriptions",
  title: "Subscriptions",
  description: "Recurring revenue, plans, and subscription management",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "sub-quick-actions-section",
          widgets: [
            {
              id: "sub-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: 2,
                actions: [
                  { id: "new_subscription", label: "New Subscription", icon: "plus", color: "green" },
                  { id: "new_plan", label: "New Plan", icon: "plus", color: "blue" },
                  {
                    id: "import_plan_csv",
                    label: t("subscriptions.dashboard.importPlanCsv"),
                    icon: "upload",
                    color: "purple",
                  },
                  {
                    id: "import_subscription_csv",
                    label: t("subscriptions.dashboard.importSubscriptionCsv"),
                    icon: "upload",
                    color: "orange",
                  },
                ],
              },
            },
          ],
        },
        {
          id: "sub-kpis",
          widgets: [
            {
              id: "sub-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Active Subscriptions", value: "0", icon: "RefreshCw" },
                  { label: "Total MRR", value: "$0", icon: "TrendingUp" },
                  { label: "Trial Subscriptions", value: "0", icon: "Clock" },
                  { label: "Plans Available", value: "0", icon: "Package" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      type: "entity",
      entityConfig: subscriptionsTableConfig(t),
      createForm: newSubscriptionForm(t),
      createLabel: "New Subscription",
      createAction: "createSubscription",
    },
    {
      id: "plans",
      label: "Plans",
      type: "entity",
      entityConfig: subscriptionPlansTableConfig(t),
      createForm: newSubscriptionPlanForm(t),
      createLabel: "New Plan",
      createAction: "createPlan",
    },
    {
      id: "deferred-schedules",
      label: "Deferred schedules",
      type: "entity",
      entityConfig: deferredRevenueSchedulesTableConfig(t),
      createForm: newDeferredRevenueScheduleForm(t),
      createLabel: "New schedule",
      createAction: "createDeferredSchedule",
    },
    {
      id: "deferred-lines",
      label: "Recognition lines",
      type: "entity",
      entityConfig: deferredRevenueLinesTableConfig(t),
    },
    {
      id: "recognition-rules",
      label: "Recognition rules",
      type: "entity",
      entityConfig: revenueRecognitionRulesTableConfig(t),
      createForm: newRevenueRecognitionRuleForm(t),
      createLabel: "New rule",
      createAction: "createRecognitionRule",
    },
  ],
})

// ─── Expenses ─────────────────────────────────────────────────────────────────

export const expensesModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "expenses",
  title: "Expenses",
  description: "Employee expense management and reimbursement",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "exp-quick-actions-section",
          widgets: [
            {
              id: "exp-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: 2,
                actions: [
                  { id: "new_expense", label: "New Expense", icon: "plus", color: "orange" },
                  { id: "new_expense_report", label: "New Report", icon: "plus", color: "blue" },
                ],
              },
            },
          ],
        },
        {
          id: "exp-kpis",
          widgets: [
            {
              id: "exp-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Pending Expenses", value: "0", icon: "Receipt" },
                  { label: "Total Amount", value: "$0", icon: "DollarSign" },
                  { label: "Expense Reports", value: "0", icon: "FileText" },
                  { label: "Approved Reports", value: "0", icon: "CheckCircle" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "expenses",
      label: "Expenses",
      type: "entity",
      entityConfig: expensesTableConfig(t),
      createForm: newExpenseForm(t),
      createLabel: "New Expense",
      createAction: "createExpense",
    },
    {
      id: "expense-sheets",
      label: "Expense Reports",
      type: "entity",
      entityConfig: expenseSheetsTableConfig(t),
      createForm: newExpenseSheetForm(t),
      createLabel: "New Report",
      createAction: "createSheet",
    },
  ],
})

// ─── Helpdesk ─────────────────────────────────────────────────────────────────

export const helpdeskModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "helpdesk",
  title: "Helpdesk",
  description: "Customer support tickets and SLA management",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "hd-quick-actions-section",
          widgets: [
            {
              id: "hd-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
                data: {
                columns: undefined,
                actions: [
                  { id: "new_ticket", label: "New Ticket", icon: "plus", color: "red" },
                  { id: "import_tickets_csv", label: t("helpdesk.actions.importTicketsCsv"), icon: "upload", color: "teal" },
                ],
              },
            },
          ],
        },
        {
          id: "hd-kpis",
          widgets: [
            {
              id: "hd-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Open Tickets", value: "0", icon: "HelpCircle" },
                  { label: "Solved Today", value: "0", icon: "CheckCircle" },
                  { label: "SLA Breached", value: "0", icon: "AlertTriangle" },
                  { label: "Urgent", value: "0", icon: "Zap" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "tickets",
      label: "Tickets",
      type: "entity",
      entityConfig: helpdeskTicketsTableConfig(t),
      createForm: newHelpdeskTicketForm(t),
      createLabel: "New Ticket",
      createAction: "createTicket",
    },
    {
      id: "teams",
      label: t("helpdesk.tabs.teams"),
      type: "entity",
      entityConfig: helpdeskTeamsTableConfig(t),
      createForm: newHelpdeskTeamForm(t),
      createLabel: t("helpdesk.tabs.newTeam"),
      createAction: "createHelpdeskTeam",
    },
    {
      id: "stages",
      label: t("helpdesk.tabs.stages"),
      type: "entity",
      entityConfig: helpdeskStagesTableConfig(t),
      createForm: newHelpdeskStageForm(t),
      createLabel: t("helpdesk.tabs.newStage"),
      createAction: "createHelpdeskStage",
    },
    {
      id: "slas",
      label: t("helpdesk.tabs.slas"),
      type: "entity",
      entityConfig: helpdeskSlasTableConfig(t),
      createForm: newHelpdeskSlaForm(t),
      createLabel: t("helpdesk.tabs.newSla"),
      createAction: "createHelpdeskSla",
    },
  ],
})

// ─── Workflows ────────────────────────────────────────────────────────────────

export const workflowsModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "workflows",
  title: "Workflows",
  description: "Automated business processes and workflow orchestration",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "wf-quick-actions-section",
          widgets: [
            {
              id: "wf-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: undefined,
                actions: [
                  { id: "new_workflow", label: "New Workflow", icon: "plus", color: "purple" },
                  { id: "import_workflow_csv", label: "Import CSV", icon: "upload", color: "teal" },
                ],
              },
            },
          ],
        },
        {
          id: "wf-kpis",
          widgets: [
            {
              id: "wf-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Active Workflows", value: "0", icon: "GitBranch" },
                  { label: "Running Instances", value: "0", icon: "Play" },
                  { label: "Completed", value: "0", icon: "CheckCircle" },
                  { label: "Cancelled", value: "0", icon: "XCircle" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "workflows",
      label: "Workflows",
      type: "entity",
      entityConfig: workflowsTableConfig(t),
      createForm: newWorkflowForm(t),
      createLabel: "New Workflow",
      createAction: "createWorkflow",
    },
    {
      id: "instances",
      label: "Instances",
      type: "entity",
      entityConfig: workflowInstancesTableConfig(t),
    },
  ],
})

// ─── Messages ─────────────────────────────────────────────────────────────────

export const messagesModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "messages",
  title: "Messages",
  description: "Internal messages, email threads, and notifications",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "msg-quick-actions-section",
          widgets: [
            {
              id: "msg-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: undefined,
                actions: [
                  { id: "new_message", label: "New Message", icon: "plus", color: "blue" },
                ],
              },
            },
          ],
        },
        {
          id: "msg-kpis",
          widgets: [
            {
              id: "msg-stat-cards",
              type: "stat-cards",
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Total Messages", value: "0", icon: "MessageSquare" },
                  { label: "Emails", value: "0", icon: "Mail" },
                  { label: "Comments", value: "0", icon: "MessageCircle" },
                  { label: "Notifications", value: "0", icon: "Bell" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "messages",
      label: "Messages",
      type: "entity",
      entityConfig: mailMessagesTableConfig(t),
      createForm: newMailMessageForm(t),
      createLabel: "New Message",
      createAction: "createMessage",
    },
  ],
})

// ─── Proposals ────────────────────────────────────────────────────────────────

export const proposalsModuleConfig = (t: TFunction): ModuleConfig => ({
  id: "proposals",
  title: "Proposals",
  description: "Business proposals, tenders, and RFP responses — AI-powered drafting and analysis",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "proposals-quick-actions-section",
          widgets: [
            {
              id: "proposals-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: 4,
                actions: [
                  { id: "new_proposal", label: "New Proposal", icon: "plus", color: "blue" },
                  { id: "use_template", label: "Use Template", icon: "file", color: "green" },
                  { id: "import_rfp", label: "Import RFP", icon: "upload", color: "orange" },
                  { id: "review_pending", label: "Review Pending", icon: "eye", color: "purple" },
                ],
              },
            },
          ],
        },
        {
          id: "proposals-kpis",
          widgets: [
            {
              id: "proposals-stat-cards",
              type: "stat-cards",
              title: "Overview",
              width: "full",
              data: {
                stats: [
                  { label: "Active Proposals", value: "0", icon: "ClipboardList" },
                  { label: "Submitted", value: "0", icon: "Send" },
                  { label: "Awarded", value: "0", icon: "Award" },
                  { label: "Pipeline Value", value: "$0", icon: "TrendingUp" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "proposals",
      label: "Proposals",
      type: "entity",
      entityConfig: proposalsTableConfig(t, {
        formatProposalDisplayName: proposalPrimaryLabel,
      }),
      createForm: newProposalForm(t),
      createLabel: "New Proposal",
      createAction: "createProposal",
    },
    {
      id: "templates",
      label: "Templates",
      type: "entity",
      entityConfig: proposalTemplatesTableConfig(t),
    },
  ],
})
