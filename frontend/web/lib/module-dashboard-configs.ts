import type { TFunction } from "i18next"
import type { DashboardConfig, ModuleConfig } from "@lumiere/ui"
import {
  proposalsTableConfig,
  proposalTemplatesTableConfig,
  newProposalForm,
} from "@lumiere/ui"
import {
  accountsTableConfig,
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
  bankStatementsTableConfig,
  fixedAssetsTableConfig,
  saleOrdersTableConfig,
  saleOrderLinesTableConfig,
  pricelistsTableConfig,
  deliveriesTableConfig,
  newSaleOrderForm,
  newPricelistForm,
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
  newTransferForm,
  newInventoryAdjustmentForm,
  stockLocationsTableConfig,
  productionLotsTableConfig,
  qualityChecksTableConfig,
  purchaseOrdersTableConfig,
  purchaseOrderLinesTableConfig,
  purchaseRequisitionsTableConfig,
  newPurchaseOrderForm,
  newPurchaseRequisitionForm,
  vendorsTableConfig,
  manufacturingOrdersTableConfig,
  bomsTableConfig,
  workordersTableConfig,
  workcentersTableConfig,
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
  newDocumentForm,
  newKnowledgeArticleForm,
  calendarEventsTableConfig,
  newCalendarEventForm,
  financialReportsTableConfig,
  trialBalancesTableConfig,
  newFinancialReportForm,
  subscriptionsTableConfig,
  subscriptionPlansTableConfig,
  newSubscriptionForm,
  newSubscriptionPlanForm,
  expensesTableConfig,
  expenseSheetsTableConfig,
  newExpenseForm,
  newExpenseSheetForm,
  helpdeskTicketsTableConfig,
  newHelpdeskTicketForm,
  workflowsTableConfig,
  workflowInstancesTableConfig,
  newWorkflowForm,
  mailMessagesTableConfig,
  newMailMessageForm,
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
      entityConfig: accountsTableConfig,
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
      label: "Analytic",
      type: "entity",
      entityConfig: analyticAccountsTableConfig,
    },
    {
      id: "bank-statements",
      label: "Bank Statements",
      type: "entity",
      entityConfig: bankStatementsTableConfig(t),
    },
    {
      id: "fixed-assets",
      label: "Fixed Assets",
      type: "entity",
      entityConfig: fixedAssetsTableConfig(t),
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
      entityConfig: saleOrdersTableConfig(t),
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
      id: "deliveries",
      label: "Deliveries",
      type: "entity",
      entityConfig: deliveriesTableConfig(t),
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
      entityConfig: contactsTableConfig(t),
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
      entityConfig: productsTableConfig(t),
      createForm: newProductForm(t),
      createLabel: "New Product",
      createAction: "createProduct",
    },
    {
      id: "stock",
      label: "Stock On Hand",
      type: "entity",
      entityConfig: stockQuantsTableConfig(t),
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
      id: "warehouses",
      label: "Warehouses",
      type: "entity",
      entityConfig: warehousesTableConfig(t),
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
    },
    {
      id: "lots",
      label: "Lots & Serials",
      type: "entity",
      entityConfig: productionLotsTableConfig(t),
    },
    {
      id: "quality",
      label: "Quality Checks",
      type: "entity",
      entityConfig: qualityChecksTableConfig(t),
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
      id: "iot-kpis",
      widgets: [
        {
          id: "iot-stat-cards",
          type: "stat-cards",
          title: "Key Metrics",
          width: "full",
          data: {
            stats: [
              { label: "Total Devices", value: "1,248", change: 4, icon: "Cpu" },
              { label: "Devices Online", value: "1,196", change: 2, icon: "Wifi" },
              { label: "Active Alerts", value: "7", change: -3, icon: "AlertTriangle" },
              { label: "Avg Uptime", value: "99.2%", change: 0.1, icon: "Activity" },
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
  title: "Reports",
  description: "Financial reports, P&L, and trial balances",
  defaultTab: "dashboard",
  tabs: [
    {
      id: "dashboard",
      label: "Dashboard",
      type: "dashboard",
      sections: [
        {
          id: "rep-quick-actions-section",
          widgets: [
            {
              id: "rep-quick-actions",
              type: "quick-actions",
              title: "Quick Actions",
              width: "full",
              data: {
                columns: undefined,
                actions: [
                  { id: "generate_report", label: "Generate Report", icon: "plus", color: "purple" },
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
              title: "Key Metrics",
              width: "full",
              data: {
                stats: [
                  { label: "Total Reports", value: "0", icon: "BarChart2" },
                  { label: "Generated", value: "0", icon: "CheckCircle" },
                  { label: "Exported", value: "0", icon: "Download" },
                  { label: "Trial Balances", value: "0", icon: "Scale" },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      id: "reports",
      label: "Financial Reports",
      type: "entity",
      entityConfig: financialReportsTableConfig(t),
      createForm: newFinancialReportForm(t),
      createLabel: "Generate Report",
      createAction: "generateReport",
    },
    {
      id: "trial-balance",
      label: "Trial Balance",
      type: "entity",
      entityConfig: trialBalancesTableConfig(t),
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
      entityConfig: proposalsTableConfig(t),
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
