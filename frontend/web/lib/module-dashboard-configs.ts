import type { DashboardConfig, ModuleConfig } from "@lumiere/ui"
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
  purchaseOrdersTableConfig,
  purchaseOrderLinesTableConfig,
  purchaseRequisitionsTableConfig,
  newPurchaseOrderForm,
  newPurchaseRequisitionForm,
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
} from "@lumiere/ui"

// ─── Accounting ──────────────────────────────────────────────────────────────

export const accountingDashboard: DashboardConfig = {
  id: "accounting",
  title: "Accounting",
  description: "Financial overview — P&L, cash position, and budget tracking",
  sections: [
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
          data: { count: 14, totalAmount: 87420, oldestDays: 42 },
        },
        {
          id: "acc-cashflow",
          type: "cash-flow",
          title: "Cash Flow Position",
          width: "1/3",
          data: { arTotal: 248320, apTotal: 134780, netPosition: 113540 },
        },
        {
          id: "acc-budget",
          type: "budget-progress",
          title: "Budget vs Actual",
          width: "1/3",
          data: {
            budgets: [
              { name: "Operations", planned: 120000, actual: 108500, variance: -9.6 },
              { name: "Marketing", planned: 60000, actual: 67200, variance: 12 },
              { name: "R&D", planned: 80000, actual: 74300, variance: -7.1 },
              { name: "Sales", planned: 95000, actual: 98400, variance: 3.6 },
            ],
          },
        },
        {
          id: "acc-balances",
          type: "account-balance",
          title: "Key Account Balances",
          width: "1/2",
          data: {
            accounts: [
              { code: "1010", name: "Cash & Equivalents", balance: 892450, type: "Asset" },
              { code: "1200", name: "Accounts Receivable", balance: 248320, type: "Asset" },
              { code: "2000", name: "Accounts Payable", balance: -134780, type: "Liability" },
              { code: "3000", name: "Retained Earnings", balance: 1240000, type: "Equity" },
              { code: "4000", name: "Revenue", balance: 1204300, type: "Income" },
            ],
          },
        },
        {
          id: "acc-tax-deadlines",
          type: "tax-deadline",
          title: "Tax Deadlines",
          width: "1/2",
          data: {
            deadlines: [
              { title: "VAT Return Q1", dueDate: "2026-04-30", status: "upcoming", daysUntil: 48 },
              { title: "Payroll Tax March", dueDate: "2026-03-20", status: "due-soon", daysUntil: 7 },
              { title: "Corporate Tax Est.", dueDate: "2026-04-15", status: "upcoming", daysUntil: 33 },
              { title: "Sales Tax Feb", dueDate: "2026-03-10", status: "overdue", daysUntil: -3 },
            ],
          },
        },
      ],
    },
  ],
}

export const accountingModuleConfig: ModuleConfig = {
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
      createForm: newAccountForm,
      createLabel: "New Account",
      createAction: "createAccount",
    },
    {
      id: "journal-entries",
      label: "Journal Entries",
      type: "entity",
      entityConfig: journalEntriesTableConfig,
      createForm: newJournalEntryForm,
      createLabel: "New Entry",
      createAction: "createMove",
    },
    {
      id: "invoices",
      label: "Invoices",
      type: "entity",
      entityConfig: journalEntriesTableConfig,
      createForm: newInvoiceForm,
      createLabel: "New Invoice",
      createAction: "createInvoice",
    },
    {
      id: "bills",
      label: "Bills",
      type: "entity",
      entityConfig: journalEntriesTableConfig,
      createForm: newBillForm,
      createLabel: "New Bill",
      createAction: "createBill",
    },
    {
      id: "taxes",
      label: "Taxes",
      type: "entity",
      entityConfig: taxesTableConfig,
      createForm: newTaxForm,
      createLabel: "New Tax",
      createAction: "createTax",
    },
    {
      id: "budgets",
      label: "Budgets",
      type: "entity",
      entityConfig: budgetsTableConfig,
      createForm: newBudgetForm,
      createLabel: "New Budget",
      createAction: "createBudget",
    },
    {
      id: "analytic",
      label: "Analytic",
      type: "entity",
      entityConfig: analyticAccountsTableConfig,
    },
  ],
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export const salesDashboard: DashboardConfig = {
  id: "sales",
  title: "Sales",
  description: "Revenue performance, pipeline health, and deal activity",
  sections: [
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
            values: [
              { month: "Oct", Revenue: 920000, Target: 950000 },
              { month: "Nov", Revenue: 1050000, Target: 1000000 },
              { month: "Dec", Revenue: 1180000, Target: 1100000 },
              { month: "Jan", Revenue: 980000, Target: 1050000 },
              { month: "Feb", Revenue: 1120000, Target: 1100000 },
              { month: "Mar", Revenue: 1204300, Target: 1150000 },
            ],
          },
        },
        {
          id: "sales-by-rep",
          type: "metrics",
          title: "Top Sales Reps",
          width: "1/3",
          data: {
            metrics: [
              { label: "Alex Chen", value: 280000, max: 350000, color: "#6366f1" },
              { label: "Maria Garcia", value: 245000, max: 350000, color: "#8b5cf6" },
              { label: "James Kim", value: 198000, max: 350000, color: "#a78bfa" },
              { label: "Sarah Lee", value: 176000, max: 350000, color: "#c4b5fd" },
            ],
          },
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
            values: [
              { product: "Enterprise Suite", Revenue: 540000 },
              { product: "Pro Plan", Revenue: 380000 },
              { product: "Starter", Revenue: 175000 },
              { product: "Add-ons", Revenue: 109300 },
            ],
          },
        },
      ],
    },
  ],
}

export const salesModuleConfig: ModuleConfig = {
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
      entityConfig: saleOrdersTableConfig,
      createForm: newSaleOrderForm,
      createLabel: "New Order",
      createAction: "createSaleOrder",
    },
    {
      id: "order-lines",
      label: "Order Lines",
      type: "entity",
      entityConfig: saleOrderLinesTableConfig,
    },
    {
      id: "pricelists",
      label: "Pricelists",
      type: "entity",
      entityConfig: pricelistsTableConfig,
      createForm: newPricelistForm,
      createLabel: "New Pricelist",
      createAction: "createPricelist",
    },
    {
      id: "deliveries",
      label: "Deliveries",
      type: "entity",
      entityConfig: deliveriesTableConfig,
    },
  ],
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

export const crmDashboard: DashboardConfig = {
  id: "crm",
  title: "CRM",
  description: "Lead pipeline, customer lifecycle, and relationship health",
  sections: [
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
            values: [
              { stage: "Prospect", Count: 98 },
              { stage: "Qualified", Count: 74 },
              { stage: "Proposal", Count: 52 },
              { stage: "Negotiation", Count: 48 },
              { stage: "Closed Won", Count: 40 },
            ],
          },
        },
        {
          id: "crm-pipeline-health",
          type: "metrics",
          title: "Pipeline Health",
          width: "1/2",
          data: {
            metrics: [
              { label: "Prospect → Qualified", value: 74, max: 98, color: "#6366f1" },
              { label: "Qualified → Proposal", value: 52, max: 74, color: "#8b5cf6" },
              { label: "Proposal → Negotiation", value: 48, max: 52, color: "#a78bfa" },
              { label: "Negotiation → Won", value: 40, max: 48, color: "#22c55e" },
            ],
          },
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
            rows: [
              { name: "Tom Hanks", company: "Acme Corp", stage: "Negotiation", value: "$240,000", lastContact: "2 days ago" },
              { name: "Sarah Connor", company: "Skynet Ltd", stage: "Proposal", value: "$180,000", lastContact: "4 days ago" },
              { name: "John Wick", company: "Continental", stage: "Qualified", value: "$95,000", lastContact: "1 week ago" },
              { name: "Ellen Ripley", company: "Weyland Corp", stage: "Prospect", value: "$310,000", lastContact: "3 days ago" },
            ],
          },
        },
      ],
    },
  ],
}

export const crmModuleConfig: ModuleConfig = {
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
      entityConfig: leadsTableConfig,
      createForm: newLeadForm,
      createLabel: "New Lead",
      createAction: "createLead",
    },
    {
      id: "opportunities",
      label: "Opportunities",
      type: "entity",
      entityConfig: opportunitiesTableConfig,
      createForm: newOpportunityForm,
      createLabel: "New Opportunity",
      createAction: "createOpportunity",
    },
    {
      id: "contacts",
      label: "Contacts",
      type: "entity",
      entityConfig: contactsTableConfig,
      createForm: newContactForm,
      createLabel: "New Contact",
      createAction: "createContact",
    },
  ],
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export const inventoryDashboard: DashboardConfig = {
  id: "inventory",
  title: "Inventory",
  description: "Stock levels, movements, valuations, and reorder alerts",
  sections: [
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
          data: {
            metrics: [
              { label: "Electronics", value: 8420, max: 12000, color: "#6366f1" },
              { label: "Mechanical Parts", value: 6100, max: 12000, color: "#8b5cf6" },
              { label: "Consumables", value: 11200, max: 12000, color: "#22c55e" },
              { label: "Raw Materials", value: 4800, max: 12000, color: "#f59e0b" },
              { label: "Finished Goods", value: 3900, max: 12000, color: "#ef4444" },
            ],
          },
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
            values: [
              { day: "Mon", In: 420, Out: 380 },
              { day: "Tue", In: 280, Out: 450 },
              { day: "Wed", In: 610, Out: 320 },
              { day: "Thu", In: 350, Out: 490 },
              { day: "Fri", In: 520, Out: 410 },
              { day: "Sat", In: 180, Out: 120 },
              { day: "Sun", In: 90, Out: 60 },
            ],
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
            rows: [
              { sku: "EL-4421", name: "Capacitor 100µF", qty: 12, reorder: 50, status: "Critical" },
              { sku: "ME-8830", name: "Bearing SKF 6205", qty: 8, reorder: 20, status: "Critical" },
              { sku: "CO-1190", name: "Isopropyl Alcohol 1L", qty: 24, reorder: 30, status: "Low" },
              { sku: "RM-2200", name: "Aluminum Sheet 2mm", qty: 45, reorder: 50, status: "Low" },
              { sku: "FG-5502", name: "Assembly Kit A", qty: 3, reorder: 15, status: "Critical" },
            ],
          },
        },
      ],
    },
  ],
}

// ─── Purchasing ───────────────────────────────────────────────────────────────

export const inventoryModuleConfig: ModuleConfig = {
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
      entityConfig: productsTableConfig,
      createForm: newProductForm,
      createLabel: "New Product",
      createAction: "createProduct",
    },
    {
      id: "stock",
      label: "Stock On Hand",
      type: "entity",
      entityConfig: stockQuantsTableConfig,
    },
    {
      id: "transfers",
      label: "Transfers",
      type: "entity",
      entityConfig: transfersTableConfig,
      createForm: newTransferForm,
      createLabel: "New Transfer",
      createAction: "createStockPicking",
    },
    {
      id: "warehouses",
      label: "Warehouses",
      type: "entity",
      entityConfig: warehousesTableConfig,
    },
    {
      id: "adjustments",
      label: "Adjustments",
      type: "entity",
      entityConfig: inventoryAdjustmentsTableConfig,
      createForm: newInventoryAdjustmentForm,
      createLabel: "New Adjustment",
      createAction: "createInventoryAdjustment",
    },
  ],
}

export const purchasingDashboard: DashboardConfig = {
  id: "purchasing",
  title: "Purchasing",
  description: "Purchase orders, vendor performance, and spend analysis",
  sections: [
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
            values: [
              { vendor: "TechSupply Co", Spend: 98400 },
              { vendor: "Global Parts", Spend: 76200 },
              { vendor: "FastShip Inc", Spend: 54800 },
              { vendor: "Precision Mfg", Spend: 47300 },
              { vendor: "ValueMart", Spend: 38100 },
            ],
          },
        },
        {
          id: "pur-on-time",
          type: "metrics",
          title: "Vendor On-Time Delivery",
          width: "1/3",
          data: {
            metrics: [
              { label: "TechSupply Co", value: 94, max: 100, color: "#22c55e" },
              { label: "Global Parts", value: 87, max: 100, color: "#6366f1" },
              { label: "FastShip Inc", value: 91, max: 100, color: "#22c55e" },
              { label: "Precision Mfg", value: 78, max: 100, color: "#f59e0b" },
              { label: "ValueMart", value: 63, max: 100, color: "#ef4444" },
            ],
          },
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
            rows: [
              { po: "PO-2024-0841", vendor: "TechSupply Co", amount: "$12,400", ordered: "Mar 5", expected: "Mar 18", status: "In Transit" },
              { po: "PO-2024-0840", vendor: "Global Parts", amount: "$8,750", ordered: "Mar 4", expected: "Mar 14", status: "Confirmed" },
              { po: "PO-2024-0839", vendor: "FastShip Inc", amount: "$3,200", ordered: "Mar 3", expected: "Mar 13", status: "In Transit" },
              { po: "PO-2024-0837", vendor: "ValueMart", amount: "$5,900", ordered: "Mar 1", expected: "Mar 10", status: "Delayed" },
            ],
          },
        },
      ],
    },
  ],
}

export const purchasingModuleConfig: ModuleConfig = {
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
      entityConfig: purchaseOrdersTableConfig,
      createForm: newPurchaseOrderForm,
      createLabel: "New Order",
      createAction: "createPurchaseOrder",
    },
    {
      id: "lines",
      label: "Order Lines",
      type: "entity",
      entityConfig: purchaseOrderLinesTableConfig,
    },
    {
      id: "requisitions",
      label: "Purchase Agreements",
      type: "entity",
      entityConfig: purchaseRequisitionsTableConfig,
      createForm: newPurchaseRequisitionForm,
      createLabel: "New Agreement",
      createAction: "createPurchaseRequisition",
    },
  ],
}

// ─── HR ───────────────────────────────────────────────────────────────────────

export const hrDashboard: DashboardConfig = {
  id: "hr",
  title: "HR & People",
  description: "Workforce overview, recruitment, attendance, and performance",
  sections: [
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
            values: [
              { dept: "Engineering", Employees: 72 },
              { dept: "Sales", Employees: 48 },
              { dept: "Operations", Employees: 38 },
              { dept: "Marketing", Employees: 24 },
              { dept: "Finance", Employees: 18 },
              { dept: "HR", Employees: 12 },
              { dept: "Other", Employees: 35 },
            ],
          },
        },
        {
          id: "hr-leave-usage",
          type: "metrics",
          title: "Leave Balance Usage",
          width: "1/2",
          data: {
            metrics: [
              { label: "Annual Leave", value: 62, max: 100, color: "#6366f1" },
              { label: "Sick Leave", value: 28, max: 100, color: "#f59e0b" },
              { label: "Remote Work Days", value: 75, max: 100, color: "#22c55e" },
              { label: "Training Hours", value: 44, max: 100, color: "#8b5cf6" },
            ],
          },
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
            rows: [
              { role: "Senior Engineer", dept: "Engineering", candidates: 24, stage: "Interviews", posted: "Feb 15" },
              { role: "Product Manager", dept: "Product", candidates: 31, stage: "Screening", posted: "Feb 20" },
              { role: "Sales Executive", dept: "Sales", candidates: 18, stage: "Offer", posted: "Mar 1" },
              { role: "DevOps Engineer", dept: "Engineering", candidates: 12, stage: "Interviews", posted: "Mar 5" },
              { role: "Finance Analyst", dept: "Finance", candidates: 9, stage: "Screening", posted: "Mar 8" },
            ],
          },
        },
      ],
    },
  ],
}

export const hrModuleConfig: ModuleConfig = {
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
      entityConfig: employeesTableConfig,
      createForm: newEmployeeForm,
      createLabel: "New Employee",
      createAction: "createEmployee",
    },
    {
      id: "departments",
      label: "Departments",
      type: "entity",
      entityConfig: departmentsTableConfig,
    },
    {
      id: "leaves",
      label: "Leave Requests",
      type: "entity",
      entityConfig: leaveRequestsTableConfig,
      createForm: newLeaveRequestForm,
      createLabel: "New Request",
      createAction: "createLeaveRequest",
    },
    {
      id: "contracts",
      label: "Contracts",
      type: "entity",
      entityConfig: contractsTableConfig,
      createForm: newContractForm,
      createLabel: "New Contract",
      createAction: "createContract",
    },
    {
      id: "payslips",
      label: "Payslips",
      type: "entity",
      entityConfig: payslipsTableConfig,
      createForm: newPayslipForm,
      createLabel: "New Payslip",
      createAction: "createPayslip",
    },
  ],
}

// ─── Manufacturing ────────────────────────────────────────────────────────────

export const manufacturingDashboard: DashboardConfig = {
  id: "manufacturing",
  title: "Manufacturing",
  description: "Production orders, work center utilization, and quality metrics",
  sections: [
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
            values: [
              { week: "W44", Planned: 1200, Actual: 1140 },
              { week: "W45", Planned: 1200, Actual: 1280 },
              { week: "W46", Planned: 1300, Actual: 1190 },
              { week: "W47", Planned: 1300, Actual: 1350 },
              { week: "W48", Planned: 1400, Actual: 1420 },
              { week: "W49", Planned: 1400, Actual: 1380 },
            ],
          },
        },
        {
          id: "mfg-work-centers",
          type: "metrics",
          title: "Work Center Utilization",
          width: "1/3",
          data: {
            metrics: [
              { label: "Assembly Line A", value: 88, max: 100, color: "#22c55e" },
              { label: "Assembly Line B", value: 74, max: 100, color: "#6366f1" },
              { label: "CNC Machining", value: 92, max: 100, color: "#22c55e" },
              { label: "Quality Control", value: 61, max: 100, color: "#f59e0b" },
              { label: "Packaging", value: 55, max: 100, color: "#f59e0b" },
            ],
          },
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
            rows: [
              { ref: "MO-2024-0441", product: "Widget A", qty: 500, progress: "72%", due: "Mar 15", status: "In Progress" },
              { ref: "MO-2024-0440", product: "Assembly B", qty: 120, progress: "45%", due: "Mar 18", status: "In Progress" },
              { ref: "MO-2024-0439", product: "Part C", qty: 2000, progress: "90%", due: "Mar 13", status: "Almost Done" },
              { ref: "MO-2024-0438", product: "Kit D", qty: 80, progress: "10%", due: "Mar 22", status: "Starting" },
            ],
          },
        },
      ],
    },
  ],
}

export const manufacturingModuleConfig: ModuleConfig = {
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
      entityConfig: manufacturingOrdersTableConfig,
      createForm: newManufacturingOrderForm,
      createLabel: "New Order",
      createAction: "createManufacturingOrder",
    },
    {
      id: "boms",
      label: "Bills of Materials",
      type: "entity",
      entityConfig: bomsTableConfig,
      createForm: newBomForm,
      createLabel: "New BOM",
      createAction: "createBom",
    },
    {
      id: "workorders",
      label: "Work Orders",
      type: "entity",
      entityConfig: workordersTableConfig,
    },
    {
      id: "workcenters",
      label: "Work Centers",
      type: "entity",
      entityConfig: workcentersTableConfig,
      createForm: newWorkcenterForm,
      createLabel: "New Work Center",
      createAction: "createWorkcenter",
    },
  ],
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projectsDashboard: DashboardConfig = {
  id: "projects",
  title: "Projects",
  description: "Project portfolio, milestones, team utilization, and budget health",
  sections: [
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
          data: {
            metrics: [
              { label: "ERP Migration", value: 72, max: 100, color: "#6366f1" },
              { label: "Website Redesign", value: 90, max: 100, color: "#22c55e" },
              { label: "Mobile App v2", value: 45, max: 100, color: "#f59e0b" },
              { label: "Data Platform", value: 28, max: 100, color: "#6366f1" },
              { label: "Security Audit", value: 60, max: 100, color: "#8b5cf6" },
            ],
          },
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
            values: [
              { project: "ERP Migration", Budget: 180000, Spent: 124000 },
              { project: "Website", Budget: 45000, Spent: 41000 },
              { project: "Mobile App", Budget: 120000, Spent: 58000 },
              { project: "Data Platform", Budget: 220000, Spent: 68000 },
            ],
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
            rows: [
              { milestone: "Backend API complete", project: "Mobile App v2", owner: "Alex Chen", due: "Mar 14", status: "On Track" },
              { milestone: "UAT sign-off", project: "ERP Migration", owner: "Maria G.", due: "Mar 16", status: "At Risk" },
              { milestone: "Go-live", project: "Website Redesign", owner: "Team", due: "Mar 17", status: "On Track" },
              { milestone: "Security review", project: "Security Audit", owner: "James K.", due: "Mar 20", status: "On Track" },
              { milestone: "Data pipeline v1", project: "Data Platform", owner: "Sarah L.", due: "Mar 24", status: "Delayed" },
            ],
          },
        },
      ],
    },
  ],
}

export const projectsModuleConfig: ModuleConfig = {
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
      entityConfig: projectsTableConfig,
      createForm: newProjectForm,
      createLabel: "New Project",
      createAction: "createProject",
    },
    {
      id: "tasks",
      label: "Tasks",
      type: "entity",
      entityConfig: tasksTableConfig,
      createForm: newTaskForm,
      createLabel: "New Task",
      createAction: "createTask",
    },
    {
      id: "timesheets",
      label: "Timesheets",
      type: "entity",
      entityConfig: timesheetsTableConfig,
    },
  ],
}

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
            values: [
              { time: "00:00", Events: 240, Alerts: 1 },
              { time: "03:00", Events: 180, Alerts: 0 },
              { time: "06:00", Events: 420, Alerts: 2 },
              { time: "09:00", Events: 890, Alerts: 3 },
              { time: "12:00", Events: 1240, Alerts: 1 },
              { time: "15:00", Events: 1380, Alerts: 2 },
              { time: "18:00", Events: 980, Alerts: 1 },
              { time: "21:00", Events: 560, Alerts: 0 },
            ],
          },
        },
        {
          id: "iot-hub-status",
          type: "metrics",
          title: "Hub Connectivity",
          width: "1/3",
          data: {
            metrics: [
              { label: "Hub Alpha (312 devices)", value: 308, max: 312, color: "#22c55e" },
              { label: "Hub Beta (290 devices)", value: 287, max: 290, color: "#22c55e" },
              { label: "Hub Gamma (418 devices)", value: 401, max: 418, color: "#6366f1" },
              { label: "Hub Delta (228 devices)", value: 200, max: 228, color: "#f59e0b" },
            ],
          },
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
            rows: [
              { device: "TMP-0084", hub: "Hub Delta", type: "Threshold", message: "Temperature > 80°C", time: "2 min ago", severity: "Critical" },
              { device: "PWR-0241", hub: "Hub Gamma", type: "Disconnect", message: "Power supply fault", time: "18 min ago", severity: "High" },
              { device: "HUM-0117", hub: "Hub Delta", type: "Threshold", message: "Humidity < 20%", time: "42 min ago", severity: "Medium" },
              { device: "MOT-0392", hub: "Hub Beta", type: "Performance", message: "Motor RPM fluctuation", time: "1h ago", severity: "Low" },
            ],
          },
        },
      ],
    },
  ],
}
