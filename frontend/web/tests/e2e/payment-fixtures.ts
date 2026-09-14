import { expect, type Page } from "@playwright/test"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

import {
  callReducerBff,
  fetchAccountIdByCode,
  scalarQueryId,
  smokeName,
  waitForMovePosted,
} from "./helpers"

/**
 * Shared operational-payment fixtures for mobile-money and pre-tenant payment specs.
 * Extracted verbatim from `mobile-money-payments.spec.ts`; the baseline dev fixture supplies
 * the primary company, MTN wallet, and customer / supplier contacts.
 */
export type QueryRow = Record<string, unknown>
export type Wallet = {
  id: number
  companyId: number
  currencyId: number
  journalId: number
}

export const MINOR_SCALE = 100
export const RECEIPT_ALLOCATIONS_MINOR = [10_000, 2_000] as const
export const SUPPLIER_SETTLEMENT_MINOR = 10_000
export const SUPPLIER_FEE_MINOR = 200

export const none = { none: [] as [] }
export const some = <T>(value: T) => ({ some: value })
export const unit = (tag: string) => ({ [tag.charAt(0).toLowerCase() + tag.slice(1)]: [] })
export const POSTABLE_MOVE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

export const moveLineBase = {
  quantity: 1,
  price_unit: 0,
  discount: 0,
  tax_ids: [] as number[],
  partner_id: null,
  product_id: null,
  product_uom_id: null,
  product_category_id: null,
  analytic_account_id: null,
  analytic_tag_ids: [] as number[],
  display_type: null,
  is_downpayment: false,
  exclude_from_invoice_tab: false,
  blocked: false,
  group_tax_id: null,
  tax_line_id: null,
  tax_group_id: null,
  tax_repartition_line_id: null,
  tax_audit: null,
  reconcile_model_id: null,
  payment_id: null,
  statement_line_id: null,
  matching_number: null,
  matching_label: null,
  expected_pay_date: null,
  expected_pay_date_currency_id: null,
  expected_pay_date_amount: 0,
  expected_pay_date_residual: 0,
  metadata: null,
}

export function fromMinor(minor: number): number {
  return minor / MINOR_SCALE
}

export function unwrapQueryValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as QueryRow
    if ("some" in record) return unwrapQueryValue(record.some)
    if ("none" in record) return null
  }
  return value
}

export function field(row: QueryRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return unwrapQueryValue(row[key])
  }
  return undefined
}

export function idOf(value: unknown): number | null {
  const raw = unwrapQueryValue(value)
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "bigint") return Number(raw)
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function numberOf(value: unknown): number | null {
  const raw = unwrapQueryValue(value)
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function enumTag(value: unknown): string {
  const raw = unwrapQueryValue(value)
  if (typeof raw === "string") return raw
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as QueryRow
    if (typeof record.tag === "string") return record.tag
    const key = Object.keys(record)[0]
    if (key) return key
  }
  return ""
}

export async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} query failed with ${response.status()}`).toBe(true)
  const json = (await response.json()) as { data?: unknown[] }
  return (json.data ?? []).filter(
    (row): row is QueryRow => row != null && typeof row === "object" && !Array.isArray(row),
  )
}

export async function waitForRow(
  page: Page,
  resource: string,
  matches: (row: QueryRow) => boolean,
  description: string,
): Promise<QueryRow> {
  let lastRows: QueryRow[] = []
  await expect
    .poll(
      async () => {
        lastRows = await queryRows(page, resource)
        return lastRows.find(matches) ?? null
      },
      { timeout: 30_000 },
    )
    .not.toBeNull()

  const row = lastRows.find(matches)
  if (!row) throw new Error(`${description} was not returned by /api/query/${resource}`)
  return row
}

export async function fetchPrimaryWallet(page: Page): Promise<Wallet> {
  const wallet = await waitForRow(
    page,
    "payment-accounts",
    (row) => String(field(row, "name")) === "MTN Main Wallet",
    "seeded MTN payment account",
  )
  const id = idOf(field(wallet, "id"))
  const companyId = idOf(field(wallet, "companyId", "company_id"))
  const currencyId = idOf(field(wallet, "currencyId", "currency_id"))
  const journalId = idOf(field(wallet, "accountJournalId", "account_journal_id"))
  if (id == null || companyId == null || currencyId == null || journalId == null) {
    throw new Error(`seeded MTN wallet is missing payment scope fields: ${JSON.stringify(wallet)}`)
  }
  return { id, companyId, currencyId, journalId }
}

export async function fetchPartnerId(page: Page, name: string, role: "customer" | "supplier"): Promise<number> {
  const partner = await waitForRow(
    page,
    "contacts",
    (row) => {
      const label = String(field(row, "name", "displayName", "display_name") ?? "")
      const roleFlag = field(
        row,
        role === "customer" ? "isCustomer" : "isVendor",
        role === "customer" ? "is_customer" : "is_vendor",
      )
      return label.includes(name) && roleFlag !== false
    },
    `${role} contact ${name}`,
  )
  const id = idOf(field(partner, "id"))
  if (id == null) throw new Error(`${role} contact ${name} has no id`)
  return id
}

export async function createWallet(
  page: Page,
  organizationId: number,
  wallet: Wallet,
  name: string,
): Promise<number> {
  await callReducerBff(page, "create_payment_account", [
    organizationId,
    {
      company_id: wallet.companyId,
      provider_code: unit("Mtn"),
      name,
      provider_label: none,
      reference_raw: some(`+1555${Date.now().toString().slice(-7)}`),
      currency_id: wallet.currencyId,
      account_journal_id: wallet.journalId,
      fee_account_id: none,
      clearing_account_id: none,
      is_primary: false,
      metadata: some(JSON.stringify({ test: "mobile-money-payments", name })),
    },
  ])

  const row = await waitForRow(
    page,
    "payment-accounts",
    (candidate) => String(field(candidate, "name")) === name,
    `payment account ${name}`,
  )
  const id = idOf(field(row, "id"))
  if (id == null) throw new Error(`payment account ${name} has no id`)
  return id
}

export async function createTransaction(
  page: Page,
  organizationId: number,
  input: {
    companyId: number
    paymentAccountId: number
    partnerId: number
    partnerType: "Customer" | "Supplier"
    direction: "Inbound" | "Outbound"
    currencyId: number
    reference: string
    grossMinor: number
    settlementMinor: number
    netMinor: number
    marker: string
  },
): Promise<number> {
  await callReducerBff(page, "create_payment_transaction", [
    organizationId,
    {
      company_id: input.companyId,
      payment_account_id: input.paymentAccountId,
      direction: unit(input.direction),
      partner_type: unit(input.partnerType),
      partner_id: input.partnerId,
      external_reference: some(input.reference),
      gross_external_amount: fromMinor(input.grossMinor),
      settlement_amount: fromMinor(input.settlementMinor),
      net_account_amount: fromMinor(input.netMinor),
      currency_id: input.currencyId,
      occurred_at: some(stbTimestampFromDate(new Date())),
      source_entity: none,
      source_entity_id: none,
      evidence_document_ids: [],
      metadata: some(JSON.stringify({ test: "mobile-money-payments", marker: input.marker })),
    },
  ])

  const row = await waitForRow(
    page,
    "payment-transactions",
    (candidate) => String(field(candidate, "externalReference", "external_reference")) === input.reference,
    `payment transaction ${input.reference}`,
  )
  const id = idOf(field(row, "id"))
  if (id == null) throw new Error(`payment transaction ${input.reference} has no id`)
  return id
}

export async function fetchJournalIdByCode(page: Page, code: string): Promise<number> {
  const rows = await queryRows(page, "account-journals")
  const row = rows.find((candidate) => String(field(candidate, "code")).toUpperCase() === code)
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`journal not found: ${code}`)
  return id
}

export async function createPostedReceivableLine(
  page: Page,
  args: {
    organizationId: number
    companyId: number
    partnerId: number
    journalId: number
    receivableAccountId: number
    revenueAccountId: number
    amount: number
    reference: string
  },
): Promise<QueryRow> {
  const moveTimestamp = stbTimestampFromDate(POSTABLE_MOVE_DATE)
  await callReducerBff(page, "create_account_move", [
    args.organizationId,
    {
      idempotency_key: args.reference,
      company_id: args.companyId,
      journal_id: args.journalId,
      move_type: { tag: "OutInvoice" },
      date: moveTimestamp,
      name: "",
      ref: args.reference,
      auto_post: false,
      to_check: false,
      is_storno: false,
      partner_id: args.partnerId,
      partner_bank_id: null,
      fiscal_position_id: null,
      invoice_date: { some: moveTimestamp },
      invoice_date_due: { some: moveTimestamp },
      invoice_payment_term_id: null,
      payment_reference: null,
      invoice_origin: null,
      invoice_partner_display_name: "Acme Corporation",
      invoice_cash_rounding_id: null,
      partner_shipping_id: null,
      sale_order_id: null,
      invoice_incoterm_id: null,
      incoterm_location: null,
      campaign_id: null,
      source_id: null,
      medium_id: null,
      secure_sequence_number: null,
      metadata: JSON.stringify({ test: "mobile-money-payments", ref: args.reference }),
    },
  ])

  const move = await waitForRow(
    page,
    "account-moves",
    (candidate) => {
      const metadata = field(candidate, "metadata")
      if (typeof metadata !== "string") return false
      try {
        return (JSON.parse(metadata) as { ref?: string }).ref === args.reference
      } catch {
        return false
      }
    },
    `payment allocation invoice ${args.reference}`,
  )
  const moveId = idOf(field(move, "id"))
  if (moveId == null) throw new Error(`payment allocation invoice ${args.reference} has no id`)

  await callReducerBff(page, "add_account_move_line", [
    args.organizationId,
    moveId,
    {
      account_id: args.receivableAccountId,
      name: "Receivable",
      debit: args.amount,
      credit: 0,
      sequence: 1,
      ...moveLineBase,
      partner_id: args.partnerId,
    },
  ])
  const receivableLine = await waitForRow(
    page,
    "account-move-lines",
    (candidate) =>
      idOf(field(candidate, "moveId", "move_id")) === moveId &&
      idOf(field(candidate, "accountId", "account_id")) === args.receivableAccountId,
    `receivable line for ${args.reference}`,
  )
  await callReducerBff(page, "add_account_move_line", [
    args.organizationId,
    moveId,
    {
      account_id: args.revenueAccountId,
      name: "Revenue",
      debit: 0,
      credit: args.amount,
      sequence: 2,
      ...moveLineBase,
    },
  ])
  await callReducerBff(page, "compute_invoice_totals", [args.organizationId, moveId])
  await callReducerBff(page, "post_account_move", [args.organizationId, moveId])
  await waitForMovePosted(page, moveId)
  return receivableLine
}

export async function createAllocationInvoices(
  page: Page,
  organizationId: number,
  companyId: number,
  customerId: number,
): Promise<QueryRow[]> {
  const journalId = await fetchJournalIdByCode(page, "INV")
  const receivableAccountId = await fetchAccountIdByCode(page, "1100")
  const revenueAccountId = await fetchAccountIdByCode(page, "4000")
  const receivableLines: QueryRow[] = []
  for (let index = 0; index < 2; index += 1) {
    receivableLines.push(await createPostedReceivableLine(page, {
      organizationId,
      companyId,
      partnerId: customerId,
      journalId,
      receivableAccountId,
      revenueAccountId,
      amount: fromMinor(RECEIPT_ALLOCATIONS_MINOR[0]),
      reference: smokeName(`mobile-money-allocation-${index + 1}`),
    }))
  }
  return receivableLines
}

export async function waitForAudit(
  page: Page,
  tableName: string,
  recordId: number,
  action: string,
): Promise<QueryRow> {
  return waitForRow(
    page,
    "audit-log",
    (row) =>
      String(field(row, "tableName", "table_name")) === tableName &&
      idOf(field(row, "recordId", "record_id")) === recordId &&
      String(field(row, "action")) === action,
    `audit entry ${tableName}/${recordId}/${action}`,
  )
}

export async function createBranchCompany(
  page: Page,
  organizationId: number,
  currencyId: number,
  name: string,
): Promise<number> {
  await callReducerBff(page, "create_company", [
    organizationId,
    {
      name,
      code: `BR${Date.now().toString().slice(-6)}`,
      currency_id: currencyId,
      fiscal_year_end_month: 12,
      fiscal_year_end_day: 31,
      is_parent: false,
      parent_id: none,
      tax_id: none,
      company_registry: none,
      address_street: none,
      address_city: none,
      address_zip: none,
      address_country_code: none,
      metadata: some(JSON.stringify({ test: "mobile-money-payments", name })),
    },
  ])

  const row = await waitForRow(
    page,
    "companies",
    (candidate) => String(field(candidate, "name")) === name,
    `branch company ${name}`,
  )
  const id = idOf(field(row, "id"))
  if (id == null) throw new Error(`branch company ${name} has no id`)
  return id
}
