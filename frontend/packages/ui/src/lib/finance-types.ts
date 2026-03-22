// Finance & Accounting Module Types

export type InvoiceStatus = "draft" | "sent" | "viewed" | "partial" | "paid" | "overdue" | "cancelled"
export type PaymentMethod = "bank_transfer" | "credit_card" | "check" | "cash" | "paypal" | "stripe"
export type PaymentStatus = "pending" | "processing" | "completed" | "failed" | "refunded"
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense"
export type TransactionType = "debit" | "credit"
export type BillStatus = "draft" | "pending" | "approved" | "partial" | "paid" | "overdue" | "cancelled"

// Invoice Types
export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  discount: number
  total: number
  productId?: string
}

export interface Invoice {
  id: string
  invoiceNumber: string
  customerId: string
  customerName: string
  customerEmail: string
  customerAddress: string
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  lineItems: InvoiceLineItem[]
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  amountPaid: number
  amountDue: number
  notes?: string
  terms?: string
  currency: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

// Payment Types
export interface Payment {
  id: string
  paymentNumber: string
  type: "incoming" | "outgoing"
  relatedType: "invoice" | "bill"
  relatedId: string
  relatedNumber: string
  amount: number
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  transactionId?: string
  paidBy: string
  paidTo: string
  paidAt: string
  notes?: string
  createdBy: string
  createdAt: string
}

// Bill Types (Accounts Payable)
export interface BillLineItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  taxRate: number
  total: number
  accountId: string
  accountName: string
}

export interface Bill {
  id: string
  billNumber: string
  vendorId: string
  vendorName: string
  vendorEmail: string
  vendorAddress: string
  status: BillStatus
  billDate: string
  dueDate: string
  lineItems: BillLineItem[]
  subtotal: number
  taxTotal: number
  total: number
  amountPaid: number
  amountDue: number
  purchaseOrderId?: string
  notes?: string
  currency: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

// Vendor Types
export interface Vendor {
  id: string
  name: string
  email: string
  phone: string
  address: string
  city: string
  country: string
  taxId?: string
  paymentTerms: number // days
  currency: string
  bankAccount?: string
  bankName?: string
  notes?: string
  totalBilled: number
  totalPaid: number
  outstandingBalance: number
  createdAt: string
}

// Chart of Accounts
export interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  parentId?: string
  description?: string
  balance: number
  currency: string
  isActive: boolean
  isSystemAccount: boolean
  createdAt: string
}

// Journal Entry (General Ledger)
export interface JournalEntryLine {
  id: string
  accountId: string
  accountCode: string
  accountName: string
  description: string
  debit: number
  credit: number
}

export interface JournalEntry {
  id: string
  entryNumber: string
  date: string
  description: string
  reference?: string
  referenceType?: "invoice" | "bill" | "payment" | "manual"
  referenceId?: string
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
  isBalanced: boolean
  isPosted: boolean
  createdBy: string
  createdAt: string
  postedAt?: string
}

// Financial Summary
export interface FinancialSummary {
  totalReceivables: number
  totalPayables: number
  cashBalance: number
  revenueThisMonth: number
  expensesThisMonth: number
  netIncomeThisMonth: number
  overdueReceivables: number
  overduePayables: number
  invoicesPending: number
  billsPending: number
}

// Status configurations
export const invoiceStatusConfig: Record<InvoiceStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: "Draft", color: "text-muted-foreground", bgColor: "bg-muted" },
  sent: { label: "Sent", color: "text-blue-600", bgColor: "bg-blue-500/10" },
  viewed: { label: "Viewed", color: "text-purple-600", bgColor: "bg-purple-500/10" },
  partial: { label: "Partial", color: "text-amber-600", bgColor: "bg-amber-500/10" },
  paid: { label: "Paid", color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  overdue: { label: "Overdue", color: "text-red-600", bgColor: "bg-red-500/10" },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", bgColor: "bg-muted" },
}

export const billStatusConfig: Record<BillStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: "Draft", color: "text-muted-foreground", bgColor: "bg-muted" },
  pending: { label: "Pending", color: "text-blue-600", bgColor: "bg-blue-500/10" },
  approved: { label: "Approved", color: "text-purple-600", bgColor: "bg-purple-500/10" },
  partial: { label: "Partial", color: "text-amber-600", bgColor: "bg-amber-500/10" },
  paid: { label: "Paid", color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  overdue: { label: "Overdue", color: "text-red-600", bgColor: "bg-red-500/10" },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", bgColor: "bg-muted" },
}

export const paymentMethodConfig: Record<PaymentMethod, { label: string; icon: string }> = {
  bank_transfer: { label: "Bank Transfer", icon: "building" },
  credit_card: { label: "Credit Card", icon: "credit-card" },
  check: { label: "Check", icon: "file-text" },
  cash: { label: "Cash", icon: "banknote" },
  paypal: { label: "PayPal", icon: "wallet" },
  stripe: { label: "Stripe", icon: "credit-card" },
}

export const accountTypeConfig: Record<AccountType, { label: string; color: string; normalBalance: TransactionType }> = {
  asset: { label: "Asset", color: "text-blue-600", normalBalance: "debit" },
  liability: { label: "Liability", color: "text-red-600", normalBalance: "credit" },
  equity: { label: "Equity", color: "text-purple-600", normalBalance: "credit" },
  revenue: { label: "Revenue", color: "text-emerald-600", normalBalance: "credit" },
  expense: { label: "Expense", color: "text-amber-600", normalBalance: "debit" },
}

// Sample Data
export const sampleVendors: Vendor[] = [
  {
    id: "vendor-1",
    name: "TechSupply Co.",
    email: "billing@techsupply.com",
    phone: "+1 555-0101",
    address: "123 Tech Street",
    city: "San Francisco, CA 94105",
    country: "USA",
    taxId: "12-3456789",
    paymentTerms: 30,
    currency: "USD",
    bankAccount: "****4521",
    bankName: "Chase Bank",
    totalBilled: 45000,
    totalPaid: 38000,
    outstandingBalance: 7000,
    createdAt: "2024-01-15",
  },
  {
    id: "vendor-2",
    name: "Office Essentials Ltd.",
    email: "accounts@officeessentials.com",
    phone: "+1 555-0102",
    address: "456 Supply Ave",
    city: "New York, NY 10001",
    country: "USA",
    taxId: "98-7654321",
    paymentTerms: 15,
    currency: "USD",
    totalBilled: 12500,
    totalPaid: 12500,
    outstandingBalance: 0,
    createdAt: "2024-02-20",
  },
  {
    id: "vendor-3",
    name: "Global Logistics Inc.",
    email: "finance@globallogistics.com",
    phone: "+1 555-0103",
    address: "789 Shipping Blvd",
    city: "Los Angeles, CA 90001",
    country: "USA",
    paymentTerms: 45,
    currency: "USD",
    totalBilled: 28000,
    totalPaid: 21000,
    outstandingBalance: 7000,
    createdAt: "2024-03-10",
  },
]

export const sampleAccounts: Account[] = [
  // Assets
  { id: "acc-1001", code: "1001", name: "Cash", type: "asset", balance: 125000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-1002", code: "1002", name: "Accounts Receivable", type: "asset", balance: 45000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-1003", code: "1003", name: "Inventory", type: "asset", balance: 78000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-1004", code: "1004", name: "Prepaid Expenses", type: "asset", balance: 5000, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  // Liabilities
  { id: "acc-2001", code: "2001", name: "Accounts Payable", type: "liability", balance: 32000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-2002", code: "2002", name: "Accrued Expenses", type: "liability", balance: 8500, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  { id: "acc-2003", code: "2003", name: "Sales Tax Payable", type: "liability", balance: 4200, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  // Equity
  { id: "acc-3001", code: "3001", name: "Owner's Equity", type: "equity", balance: 150000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-3002", code: "3002", name: "Retained Earnings", type: "equity", balance: 45000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  // Revenue
  { id: "acc-4001", code: "4001", name: "Sales Revenue", type: "revenue", balance: 285000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-4002", code: "4002", name: "Service Revenue", type: "revenue", balance: 42000, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  { id: "acc-4003", code: "4003", name: "Interest Income", type: "revenue", balance: 1200, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  // Expenses
  { id: "acc-5001", code: "5001", name: "Cost of Goods Sold", type: "expense", balance: 142000, currency: "USD", isActive: true, isSystemAccount: true, createdAt: "2024-01-01" },
  { id: "acc-5002", code: "5002", name: "Salaries & Wages", type: "expense", balance: 65000, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  { id: "acc-5003", code: "5003", name: "Rent Expense", type: "expense", balance: 18000, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  { id: "acc-5004", code: "5004", name: "Utilities Expense", type: "expense", balance: 4500, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
  { id: "acc-5005", code: "5005", name: "Office Supplies", type: "expense", balance: 2800, currency: "USD", isActive: true, isSystemAccount: false, createdAt: "2024-01-01" },
]

export const sampleInvoices: Invoice[] = [
  {
    id: "inv-001",
    invoiceNumber: "INV-2024-001",
    customerId: "cust-1",
    customerName: "Acme Corporation",
    customerEmail: "billing@acme.com",
    customerAddress: "100 Main St, Boston, MA 02101",
    status: "paid",
    issueDate: "2024-03-01",
    dueDate: "2024-03-31",
    lineItems: [
      { id: "li-1", description: "Enterprise Software License", quantity: 1, unitPrice: 5000, taxRate: 8, discount: 0, total: 5400 },
      { id: "li-2", description: "Implementation Services", quantity: 20, unitPrice: 150, taxRate: 8, discount: 0, total: 3240 },
    ],
    subtotal: 8000,
    taxTotal: 640,
    discountTotal: 0,
    total: 8640,
    amountPaid: 8640,
    amountDue: 0,
    notes: "Thank you for your business!",
    terms: "Net 30",
    currency: "USD",
    createdBy: "user-admin",
    createdAt: "2024-03-01",
    updatedAt: "2024-03-15",
  },
  {
    id: "inv-002",
    invoiceNumber: "INV-2024-002",
    customerId: "cust-2",
    customerName: "TechStart Inc.",
    customerEmail: "ap@techstart.io",
    customerAddress: "250 Innovation Way, Austin, TX 78701",
    status: "sent",
    issueDate: "2024-03-10",
    dueDate: "2024-04-09",
    lineItems: [
      { id: "li-3", description: "Monthly SaaS Subscription", quantity: 12, unitPrice: 499, taxRate: 8.25, discount: 10, total: 5829.09 },
    ],
    subtotal: 5988,
    taxTotal: 439.32,
    discountTotal: 598.23,
    total: 5829.09,
    amountPaid: 0,
    amountDue: 5829.09,
    terms: "Net 30",
    currency: "USD",
    createdBy: "user-admin",
    createdAt: "2024-03-10",
    updatedAt: "2024-03-10",
  },
  {
    id: "inv-003",
    invoiceNumber: "INV-2024-003",
    customerId: "cust-3",
    customerName: "Global Retail Group",
    customerEmail: "finance@globalretail.com",
    customerAddress: "500 Commerce Dr, Chicago, IL 60601",
    status: "overdue",
    issueDate: "2024-02-15",
    dueDate: "2024-03-15",
    lineItems: [
      { id: "li-4", description: "Inventory Management System", quantity: 1, unitPrice: 15000, taxRate: 6.25, discount: 5, total: 15140.63 },
      { id: "li-5", description: "Training (8 hours)", quantity: 8, unitPrice: 200, taxRate: 6.25, discount: 0, total: 1700 },
    ],
    subtotal: 16600,
    taxTotal: 990.63,
    discountTotal: 750,
    total: 16840.63,
    amountPaid: 5000,
    amountDue: 11840.63,
    terms: "Net 30",
    currency: "USD",
    createdBy: "user-admin",
    createdAt: "2024-02-15",
    updatedAt: "2024-03-01",
  },
  {
    id: "inv-004",
    invoiceNumber: "INV-2024-004",
    customerId: "cust-4",
    customerName: "HealthCare Plus",
    customerEmail: "accounts@healthcareplus.org",
    customerAddress: "75 Medical Center Blvd, Miami, FL 33101",
    status: "partial",
    issueDate: "2024-03-05",
    dueDate: "2024-04-04",
    lineItems: [
      { id: "li-6", description: "HIPAA Compliance Module", quantity: 1, unitPrice: 8500, taxRate: 7, discount: 0, total: 9095 },
    ],
    subtotal: 8500,
    taxTotal: 595,
    discountTotal: 0,
    total: 9095,
    amountPaid: 4500,
    amountDue: 4595,
    terms: "Net 30",
    currency: "USD",
    createdBy: "user-manager",
    createdAt: "2024-03-05",
    updatedAt: "2024-03-12",
  },
]

export const sampleBills: Bill[] = [
  {
    id: "bill-001",
    billNumber: "BILL-2024-001",
    vendorId: "vendor-1",
    vendorName: "TechSupply Co.",
    vendorEmail: "billing@techsupply.com",
    vendorAddress: "123 Tech Street, San Francisco, CA 94105",
    status: "pending",
    billDate: "2024-03-05",
    dueDate: "2024-04-04",
    lineItems: [
      { id: "bli-1", description: "Server Hardware", quantity: 2, unitPrice: 2500, taxRate: 8, total: 5400, accountId: "acc-1003", accountName: "Inventory" },
      { id: "bli-2", description: "Network Equipment", quantity: 5, unitPrice: 300, taxRate: 8, total: 1620, accountId: "acc-1003", accountName: "Inventory" },
    ],
    subtotal: 6500,
    taxTotal: 520,
    total: 7020,
    amountPaid: 0,
    amountDue: 7020,
    notes: "Q1 infrastructure upgrade",
    currency: "USD",
    createdBy: "user-admin",
    createdAt: "2024-03-05",
    updatedAt: "2024-03-05",
  },
  {
    id: "bill-002",
    billNumber: "BILL-2024-002",
    vendorId: "vendor-2",
    vendorName: "Office Essentials Ltd.",
    vendorEmail: "accounts@officeessentials.com",
    vendorAddress: "456 Supply Ave, New York, NY 10001",
    status: "paid",
    billDate: "2024-02-20",
    dueDate: "2024-03-06",
    lineItems: [
      { id: "bli-3", description: "Office Furniture", quantity: 10, unitPrice: 450, taxRate: 8.875, total: 4899.38, accountId: "acc-5005", accountName: "Office Supplies" },
    ],
    subtotal: 4500,
    taxTotal: 399.38,
    total: 4899.38,
    amountPaid: 4899.38,
    amountDue: 0,
    currency: "USD",
    createdBy: "user-manager",
    createdAt: "2024-02-20",
    updatedAt: "2024-03-01",
  },
  {
    id: "bill-003",
    billNumber: "BILL-2024-003",
    vendorId: "vendor-3",
    vendorName: "Global Logistics Inc.",
    vendorEmail: "finance@globallogistics.com",
    vendorAddress: "789 Shipping Blvd, Los Angeles, CA 90001",
    status: "overdue",
    billDate: "2024-02-01",
    dueDate: "2024-03-17",
    lineItems: [
      { id: "bli-4", description: "Freight Services - January", quantity: 1, unitPrice: 3500, taxRate: 0, total: 3500, accountId: "acc-5001", accountName: "Cost of Goods Sold" },
      { id: "bli-5", description: "Freight Services - February", quantity: 1, unitPrice: 3500, taxRate: 0, total: 3500, accountId: "acc-5001", accountName: "Cost of Goods Sold" },
    ],
    subtotal: 7000,
    taxTotal: 0,
    total: 7000,
    amountPaid: 0,
    amountDue: 7000,
    currency: "USD",
    createdBy: "user-admin",
    createdAt: "2024-02-01",
    updatedAt: "2024-02-01",
  },
]

export const samplePayments: Payment[] = [
  {
    id: "pay-001",
    paymentNumber: "PAY-2024-001",
    type: "incoming",
    relatedType: "invoice",
    relatedId: "inv-001",
    relatedNumber: "INV-2024-001",
    amount: 8640,
    currency: "USD",
    method: "bank_transfer",
    status: "completed",
    transactionId: "TXN-98765",
    paidBy: "Acme Corporation",
    paidTo: "Our Company",
    paidAt: "2024-03-15",
    createdBy: "user-admin",
    createdAt: "2024-03-15",
  },
  {
    id: "pay-002",
    paymentNumber: "PAY-2024-002",
    type: "incoming",
    relatedType: "invoice",
    relatedId: "inv-003",
    relatedNumber: "INV-2024-003",
    amount: 5000,
    currency: "USD",
    method: "credit_card",
    status: "completed",
    paidBy: "Global Retail Group",
    paidTo: "Our Company",
    paidAt: "2024-03-01",
    createdBy: "user-admin",
    createdAt: "2024-03-01",
  },
  {
    id: "pay-003",
    paymentNumber: "PAY-2024-003",
    type: "incoming",
    relatedType: "invoice",
    relatedId: "inv-004",
    relatedNumber: "INV-2024-004",
    amount: 4500,
    currency: "USD",
    method: "check",
    status: "completed",
    paidBy: "HealthCare Plus",
    paidTo: "Our Company",
    paidAt: "2024-03-12",
    createdBy: "user-manager",
    createdAt: "2024-03-12",
  },
  {
    id: "pay-004",
    paymentNumber: "PAY-2024-004",
    type: "outgoing",
    relatedType: "bill",
    relatedId: "bill-002",
    relatedNumber: "BILL-2024-002",
    amount: 4899.38,
    currency: "USD",
    method: "bank_transfer",
    status: "completed",
    paidBy: "Our Company",
    paidTo: "Office Essentials Ltd.",
    paidAt: "2024-03-01",
    createdBy: "user-admin",
    createdAt: "2024-03-01",
  },
]

export const sampleJournalEntries: JournalEntry[] = [
  {
    id: "je-001",
    entryNumber: "JE-2024-001",
    date: "2024-03-15",
    description: "Record payment received from Acme Corporation",
    reference: "INV-2024-001",
    referenceType: "payment",
    referenceId: "pay-001",
    lines: [
      { id: "jel-1", accountId: "acc-1001", accountCode: "1001", accountName: "Cash", description: "Payment received", debit: 8640, credit: 0 },
      { id: "jel-2", accountId: "acc-1002", accountCode: "1002", accountName: "Accounts Receivable", description: "Clear AR", debit: 0, credit: 8640 },
    ],
    totalDebit: 8640,
    totalCredit: 8640,
    isBalanced: true,
    isPosted: true,
    createdBy: "user-admin",
    createdAt: "2024-03-15",
    postedAt: "2024-03-15",
  },
  {
    id: "je-002",
    entryNumber: "JE-2024-002",
    date: "2024-03-01",
    description: "Record bill payment to Office Essentials",
    reference: "BILL-2024-002",
    referenceType: "payment",
    referenceId: "pay-004",
    lines: [
      { id: "jel-3", accountId: "acc-2001", accountCode: "2001", accountName: "Accounts Payable", description: "Clear AP", debit: 4899.38, credit: 0 },
      { id: "jel-4", accountId: "acc-1001", accountCode: "1001", accountName: "Cash", description: "Payment made", debit: 0, credit: 4899.38 },
    ],
    totalDebit: 4899.38,
    totalCredit: 4899.38,
    isBalanced: true,
    isPosted: true,
    createdBy: "user-admin",
    createdAt: "2024-03-01",
    postedAt: "2024-03-01",
  },
]

// ── POS Types ────────────────────────────────────────────────────────────────

export type POSOrderStatus = "open" | "paid" | "refunded" | "voided"
export type POSPaymentMethod = "cash" | "card" | "split" | "voucher"

export interface POSProduct {
  id: string
  name: string
  sku: string
  price: number
  taxRate: number
  category: string
  stock: number
  imageColor: string // tailwind bg colour class for placeholder
}

export interface POSCartItem {
  product: POSProduct
  quantity: number
  discountPct: number
  lineTotal: number
}

export interface POSOrder {
  id: string
  orderNumber: string
  cashier: string
  items: POSCartItem[]
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  amountTendered: number
  change: number
  paymentMethod: POSPaymentMethod
  status: POSOrderStatus
  createdAt: string
}

export const posProducts: POSProduct[] = [
  { id: "pos-1", name: "Wireless Keyboard", sku: "WKB-001", price: 79.99, taxRate: 8, category: "Electronics", stock: 24, imageColor: "bg-blue-500" },
  { id: "pos-2", name: "USB-C Hub (7-in-1)", sku: "UCH-007", price: 49.99, taxRate: 8, category: "Electronics", stock: 41, imageColor: "bg-indigo-500" },
  { id: "pos-3", name: "Ergonomic Mouse", sku: "EM-003", price: 59.99, taxRate: 8, category: "Electronics", stock: 18, imageColor: "bg-violet-500" },
  { id: "pos-4", name: "Monitor Stand", sku: "MS-002", price: 34.99, taxRate: 8, category: "Accessories", stock: 32, imageColor: "bg-slate-500" },
  { id: "pos-5", name: "Desk Organizer", sku: "DO-005", price: 19.99, taxRate: 6, category: "Office", stock: 55, imageColor: "bg-amber-500" },
  { id: "pos-6", name: "Notebook (A5)", sku: "NB-A5", price: 9.99, taxRate: 0, category: "Stationery", stock: 120, imageColor: "bg-emerald-500" },
  { id: "pos-7", name: "HDMI Cable 2m", sku: "HDMI-2M", price: 14.99, taxRate: 8, category: "Cables", stock: 78, imageColor: "bg-orange-500" },
  { id: "pos-8", name: "Webcam 1080p", sku: "WC-1080", price: 89.99, taxRate: 8, category: "Electronics", stock: 12, imageColor: "bg-cyan-500" },
  { id: "pos-9", name: "Mechanical Pencil", sku: "MP-05", price: 4.99, taxRate: 0, category: "Stationery", stock: 200, imageColor: "bg-rose-500" },
  { id: "pos-10", name: "Cable Organizer Kit", sku: "COK-01", price: 12.99, taxRate: 6, category: "Accessories", stock: 65, imageColor: "bg-teal-500" },
  { id: "pos-11", name: "LED Desk Lamp", sku: "LDL-03", price: 44.99, taxRate: 8, category: "Lighting", stock: 29, imageColor: "bg-yellow-500" },
  { id: "pos-12", name: "Sticky Notes Pack", sku: "SNP-100", price: 6.99, taxRate: 0, category: "Stationery", stock: 300, imageColor: "bg-pink-500" },
]

// ── Financial summary calculation ────────────────────────────────────────────
export function calculateFinancialSummary(
  invoices: Invoice[],
  bills: Bill[],
  accounts: Account[]
): FinancialSummary {
  const totalReceivables = invoices.reduce((sum, inv) => sum + inv.amountDue, 0)
  const totalPayables = bills.reduce((sum, bill) => sum + bill.amountDue, 0)
  const cashAccount = accounts.find(a => a.code === "1001")
  const cashBalance = cashAccount?.balance || 0

  const revenueAccounts = accounts.filter(a => a.type === "revenue")
  const expenseAccounts = accounts.filter(a => a.type === "expense")
  const revenueThisMonth = revenueAccounts.reduce((sum, a) => sum + a.balance, 0) * 0.15 // Approximate monthly
  const expensesThisMonth = expenseAccounts.reduce((sum, a) => sum + a.balance, 0) * 0.15

  const overdueInvoices = invoices.filter(inv => inv.status === "overdue")
  const overdueBills = bills.filter(bill => bill.status === "overdue")

  return {
    totalReceivables,
    totalPayables,
    cashBalance,
    revenueThisMonth,
    expensesThisMonth,
    netIncomeThisMonth: revenueThisMonth - expensesThisMonth,
    overdueReceivables: overdueInvoices.reduce((sum, inv) => sum + inv.amountDue, 0),
    overduePayables: overdueBills.reduce((sum, bill) => sum + bill.amountDue, 0),
    invoicesPending: invoices.filter(inv => ["sent", "viewed", "partial"].includes(inv.status)).length,
    billsPending: bills.filter(bill => ["pending", "approved", "partial"].includes(bill.status)).length,
  }
}
