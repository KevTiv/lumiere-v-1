/**
 * Typed owner-report schemas mirrored from `api-server/src/reports/*`.
 *
 * These are the browser-side contract for the typed report catalog and preview
 * envelopes. They are intentionally strict: do not loosen to `any` to keep AI
 * report composition and owner previews safe.
 */

export type ReportAvailability = "preview" | "planned"

export type ReportKey =
  | "daily_business_summary_v1"
  | "cash_mobile_money_v1"
  | "customer_balances_v1"
  | "supplier_payables_v1"
  | "low_stock_v1"
  | "stock_movement_v1"
  | "sales_by_product_v1"
  | "purchase_spend_v1"
  | "payment_fee_summary_v1"
  | "monthly_owner_report_v1"

export const REPORT_KEYS: ReportKey[] = [
  "daily_business_summary_v1",
  "cash_mobile_money_v1",
  "customer_balances_v1",
  "supplier_payables_v1",
  "low_stock_v1",
  "stock_movement_v1",
  "sales_by_product_v1",
  "purchase_spend_v1",
  "payment_fee_summary_v1",
  "monthly_owner_report_v1",
]

export interface ReportCatalogEntry {
  key: ReportKey
  schemaVersion: number
  title: string
  description: string
  mandatorySections: string[]
  authoritativeSources: string[]
  availability: ReportAvailability
  maxWindowDays: number
}

export interface ReportCatalogV1 {
  catalogSchemaVersion: number
  reports: ReportCatalogEntry[]
}

export interface ReportPreviewRequest {
  companyId: number
  date: string
  timezone: string
}

export interface ReportScope {
  organizationId: number
  companyId: number
  dateFrom: string
  dateToExclusive: string
  timezone: string
}

export interface ReportCurrency {
  currencyId: number
  minorUnitScale: number
}

export interface SourceRowCount {
  source: string
  rows: number
}

export interface SourceWatermark {
  accountingCutoff: string
  queriedAt: string
  sourceRows: SourceRowCount[]
}

export interface ReportEnvelope<T> {
  reportKey: ReportKey
  schemaVersion: number
  scope: ReportScope
  generatedAt: string
  generatedBy: string
  currency: ReportCurrency
  sourceWatermark: SourceWatermark
  caveats: string[]
  watermark: string
  report: T
}

// ── Daily Business Summary V1 ────────────────────────────────────────────────

export type SaleState = "Draft" | "Sent" | "Sale" | "Done" | "Cancelled" | "ToApprove"
export type PurchaseState = "Draft" | "Sent" | "ToApprove" | "Purchase" | "Done" | "Cancelled"
export type PaymentDirection = "Inbound" | "Outbound"
export type PaymentStatus = "Draft" | "Posted" | "Reversed" | "Voided"

export interface MoneyAmount {
  minorUnits: number
  scale: number
}

export interface SalesLine {
  orderId: number
  net: MoneyAmount
  tax: MoneyAmount
  gross: MoneyAmount
}

export interface SalesSummary {
  orderCount: number
  net: MoneyAmount
  tax: MoneyAmount
  gross: MoneyAmount
  lines: SalesLine[]
}

export interface PaymentLine {
  transactionId: number
  direction: PaymentDirection
  amount: MoneyAmount
}

export interface ReceiptsSummary {
  receiptCount: number
  receiptTotal: MoneyAmount
  disbursementCount: number
  disbursementTotal: MoneyAmount
  lines: PaymentLine[]
}

export interface PurchaseLine {
  orderId: number
  net: MoneyAmount
  tax: MoneyAmount
  gross: MoneyAmount
}

export interface PurchasesSummary {
  orderCount: number
  net: MoneyAmount
  tax: MoneyAmount
  gross: MoneyAmount
  lines: PurchaseLine[]
}

export interface FeeLine {
  feeId: number
  paymentTransactionId: number
  fee: MoneyAmount
  tax: MoneyAmount
  total: MoneyAmount
}

export interface ExpensesAndFeesSummary {
  feeCount: number
  fees: MoneyAmount
  tax: MoneyAmount
  total: MoneyAmount
  lines: FeeLine[]
}

export interface StockAlertLine {
  quantId: number
  productId: number
  onHand: number
  reserved: number
  available: number
  outdated: boolean
}

export interface StockAlertsSummary {
  alertCount: number
  lines: StockAlertLine[]
}

export interface ReportException {
  code: string
  source: string
  sourceId: number
  message: string
}

export interface ExceptionsSummary {
  count: number
  lines: ReportException[]
}

export interface DailyTotals {
  salesGross: MoneyAmount
  purchasesGross: MoneyAmount
  receipts: MoneyAmount
  disbursements: MoneyAmount
  feesAndTax: MoneyAmount
  netCashFlow: MoneyAmount
}

export interface DailyBusinessSummaryReportV1 {
  sales: SalesSummary
  receipts: ReceiptsSummary
  purchases: PurchasesSummary
  expensesAndFees: ExpensesAndFeesSummary
  stockAlerts: StockAlertsSummary
  exceptions: ExceptionsSummary
  totals: DailyTotals
}

// ── Preview union ────────────────────────────────────────────────────────────

export type ReportPreview =
  | ReportEnvelope<DailyBusinessSummaryReportV1>

// ── Type guards ──────────────────────────────────────────────────────────────

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === "string" && (REPORT_KEYS as string[]).includes(value)
}

export function isReportPreviewAvailable(entry: ReportCatalogEntry): boolean {
  return entry.availability === "preview"
}
