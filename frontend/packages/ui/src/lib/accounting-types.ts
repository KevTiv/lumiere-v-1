// Minimal local types matching the SpacetimeDB-generated shapes used by accounting components.
// The real types from @lumiere/stdb are structurally compatible (duck typing).

export interface Timestamp {
  microsSinceUnixEpoch: bigint
}

export interface AccountMove {
  id: bigint | number | string
  name?: string | null
  state: unknown          // stringified: "Draft" | "Posted" | "Cancelled"
  paymentState: unknown   // stringified: "Paid" | "InPayment" | "Partial" | "NotPaid"
  moveType: unknown       // stringified: "OutInvoice" | "InInvoice" | etc.
  amountTotal: number
  amountResidual: number
  amountUntaxed: number
  amountTax: number
  invoiceDate?: Timestamp | null
  invoiceDateDue?: Timestamp | null
  invoicePartnerDisplayName?: string | null
  partnerId?: unknown
  ref?: string | null
  invoiceOrigin?: string | null
  createDate?: Timestamp | null
  date?: Timestamp | null
}

export interface AccountAccount {
  id: bigint | number | string
  code: string
  name: string
  internalGroup?: unknown  // stringified: "Asset" | "Liability" | "Equity" | "Income" | "Expense"
  isBankAccount: boolean
  used: boolean
  deprecated: boolean
  openingBalance: number
}

export interface CreateAccountMoveParams {
  moveType?: unknown
  invoicePartnerDisplayName?: string | null
  amountUntaxed?: number
  amountTax?: number
  amountTotal?: number
  amountResidual?: number
  metadata?: string | null
  [key: string]: unknown
}
