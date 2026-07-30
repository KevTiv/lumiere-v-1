import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  callReducerBffResult,
  fetchSessionOrganizationId,
  smokeName,
} from "./helpers"

/**
 * Phase-1 payment scenarios use the operational payment reducers through the
 * authenticated BFF. The current Accounting UI exposes legacy AccountPayment,
 * not PaymentTransaction, so this spec deliberately verifies the API boundary
 * and read-model evidence used by the payment workspace.
 *
 * The baseline dev fixture supplies the primary company, MTN wallet, customer /
 * supplier contacts, and at least two posted receivable move lines. Every mutable
 * row in this spec has a scenario-specific name, reference, or metadata marker.
 */

type QueryRow = Record<string, unknown>
type Wallet = {
  id: number
  companyId: number
  currencyId: number
  journalId: number
}

const MINOR_SCALE = 100
const RECEIPT_ALLOCATIONS_MINOR = [10_000, 2_000] as const
const SUPPLIER_SETTLEMENT_MINOR = 10_000
const SUPPLIER_FEE_MINOR = 200

const none = { none: [] as [] }
const some = <T>(value: T) => ({ some: value })
const unit = (tag: string) => ({ [tag.charAt(0).toLowerCase() + tag.slice(1)]: [] })

function fromMinor(minor: number): number {
  return minor / MINOR_SCALE
}

function unwrapQueryValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as QueryRow
    if ("some" in record) return unwrapQueryValue(record.some)
    if ("none" in record) return null
  }
  return value
}

function field(row: QueryRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return unwrapQueryValue(row[key])
  }
  return undefined
}

function idOf(value: unknown): number | null {
  const raw = unwrapQueryValue(value)
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "bigint") return Number(raw)
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function numberOf(value: unknown): number | null {
  const raw = unwrapQueryValue(value)
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function enumTag(value: unknown): string {
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

async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} query failed with ${response.status()}`).toBe(true)
  const json = (await response.json()) as { data?: unknown[] }
  return (json.data ?? []).filter(
    (row): row is QueryRow => row != null && typeof row === "object" && !Array.isArray(row),
  )
}

async function waitForRow(
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

async function fetchPrimaryWallet(page: Page): Promise<Wallet> {
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

async function fetchPartnerId(page: Page, name: string, role: "customer" | "supplier"): Promise<number> {
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

async function createWallet(
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

async function createTransaction(
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
      occurred_at: none,
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

async function postedReceivableLines(page: Page, companyId: number): Promise<QueryRow[]> {
  const rows = await queryRows(page, "account-move-lines")
  const candidates = rows.filter((row) => {
    const rowCompanyId = idOf(field(row, "companyId", "company_id"))
    const residual = numberOf(field(row, "amountResidual", "amount_residual")) ?? 0
    return (
      rowCompanyId === companyId &&
      enumTag(field(row, "accountInternalType", "account_internal_type")).toLowerCase() ===
      "receivable" &&
      residual >= fromMinor(RECEIPT_ALLOCATIONS_MINOR[0])
    )
  })

  const uniqueMoveLines = new Map<number, QueryRow>()
  for (const line of candidates) {
    const moveId = idOf(field(line, "moveId", "move_id"))
    if (moveId != null && !uniqueMoveLines.has(moveId)) uniqueMoveLines.set(moveId, line)
  }
  const lines = [...uniqueMoveLines.values()].slice(0, 2)
  if (lines.length !== 2) {
    throw new Error(
      "Phase-1 payment fixture requires two posted receivable lines with at least 10,000 minor units outstanding",
    )
  }
  return lines
}

async function waitForAudit(
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

async function createBranchCompany(
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

async function createSecondOrganization(
  page: Page,
  primaryOrganizationId: number,
  currencyId: number,
  name: string,
): Promise<number> {
  await callReducerBff(page, "create_organization", [
    {
      name,
      code: `B${Date.now().toString().slice(-7)}`,
      timezone: "UTC",
      date_format: "YYYY-MM-DD",
      language: "en",
      is_active: true,
      description: none,
      logo_url: none,
      website: none,
      email: none,
      phone: none,
      currency_id: some(currencyId),
      metadata: some(JSON.stringify({ test: "mobile-money-payments", name })),
    },
  ])

  const row = await waitForRow(
    page,
    "user-organization",
    (candidate) => {
      const id = idOf(field(candidate, "organizationId", "organization_id"))
      return id != null && id !== primaryOrganizationId
    },
    `secondary organization membership ${name}`,
  )
  const id = idOf(field(row, "organizationId", "organization_id"))
  if (id == null) throw new Error(`secondary organization ${name} membership has no organization id`)
  return id
}

test.describe("Mobile-money payment transactions", { tag: "@dev-fixture" }, () => {
  test("P1-PAY-01 posts a partial incoming receipt across two invoices with allocation and audit evidence", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const wallet = await fetchPrimaryWallet(page)
    const customerId = await fetchPartnerId(page, "Acme Corporation", "customer")
    const receivableLines = await postedReceivableLines(page, wallet.companyId)
    const reference = smokeName("mtn-receipt")
    const transactionId = await createTransaction(page, organizationId, {
      companyId: wallet.companyId,
      paymentAccountId: wallet.id,
      partnerId: customerId,
      partnerType: "Customer",
      direction: "Inbound",
      currencyId: wallet.currencyId,
      reference,
      grossMinor: RECEIPT_ALLOCATIONS_MINOR[0] + RECEIPT_ALLOCATIONS_MINOR[1],
      settlementMinor: RECEIPT_ALLOCATIONS_MINOR[0] + RECEIPT_ALLOCATIONS_MINOR[1],
      netMinor: RECEIPT_ALLOCATIONS_MINOR[0] + RECEIPT_ALLOCATIONS_MINOR[1],
      marker: reference,
    })

    await callReducerBff(page, "post_payment_transaction", [organizationId, transactionId])
    const posted = await waitForRow(
      page,
      "payment-transactions",
      (row) => idOf(field(row, "id")) === transactionId && enumTag(field(row, "status")) === "Posted",
      `posted payment transaction ${reference}`,
    )
    expect(idOf(field(posted, "accountPaymentId", "account_payment_id"))).toBeGreaterThan(0)

    for (const [index, allocatedMinor] of RECEIPT_ALLOCATIONS_MINOR.entries()) {
      const lineId = idOf(field(receivableLines[index], "id"))
      if (lineId == null) throw new Error(`receivable allocation target ${index + 1} has no id`)
      await callReducerBff(page, "allocate_payment_transaction", [
        organizationId,
        {
          idempotency_key: `e2e-payment-allocation:${reference}:${index + 1}`,
          company_id: wallet.companyId,
          payment_transaction_id: transactionId,
          allocated_move_line_id: lineId,
          allocated_amount: fromMinor(allocatedMinor),
          currency_id: wallet.currencyId,
          write_off_amount: 0,
          write_off_account_id: none,
          metadata: some(JSON.stringify({ test: "mobile-money-payments", reference, allocation: index + 1 })),
        },
      ])
    }

    const allocations = await expect
      .poll(
        async () =>
          (await queryRows(page, "payment-reconciliations")).filter(
            (row) => idOf(field(row, "paymentTransactionId", "payment_transaction_id")) === transactionId,
          ),
        { timeout: 30_000 },
      )
      .toHaveLength(2)
      .then(async () =>
        (await queryRows(page, "payment-reconciliations")).filter(
          (row) => idOf(field(row, "paymentTransactionId", "payment_transaction_id")) === transactionId,
        ),
      )

    const allocatedAmounts = allocations
      .map((row) => numberOf(field(row, "allocatedAmount", "allocated_amount")))
      .sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(allocatedAmounts).toEqual(
      RECEIPT_ALLOCATIONS_MINOR.map(fromMinor).sort((a, b) => a - b),
    )
    for (const allocation of allocations) {
      const before = numberOf(field(allocation, "residualBefore", "residual_before"))
      const amount = numberOf(field(allocation, "allocatedAmount", "allocated_amount"))
      const after = numberOf(field(allocation, "residualAfter", "residual_after"))
      expect(before).not.toBeNull()
      expect(amount).not.toBeNull()
      expect(after).toBeCloseTo((before ?? 0) - (amount ?? 0), 6)
      expect(field(allocation, "isReversal", "is_reversal")).toBe(false)
    }

    await waitForAudit(page, "payment_transaction", transactionId, "POST")
    for (const allocation of allocations) {
      const allocationId = idOf(field(allocation, "id"))
      if (allocationId == null) throw new Error("payment reconciliation has no id")
      await waitForAudit(page, "payment_reconciliation", allocationId, "CREATE")
    }
  })

  test("P1-PAY-02 rejects a normalized duplicate reference but permits it in a distinct account scope and denies company/tenant forgery", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const wallet = await fetchPrimaryWallet(page)
    const customerId = await fetchPartnerId(page, "Acme Corporation", "customer")
    const reference = smokeName("mtn-duplicate").toUpperCase()
    const marker = smokeName("p1-pay-02")

    await createTransaction(page, organizationId, {
      companyId: wallet.companyId,
      paymentAccountId: wallet.id,
      partnerId: customerId,
      partnerType: "Customer",
      direction: "Inbound",
      currencyId: wallet.currencyId,
      reference,
      grossMinor: 1_000,
      settlementMinor: 1_000,
      netMinor: 1_000,
      marker,
    })

    const duplicate = await callReducerBffResult(page, "create_payment_transaction", [
      organizationId,
      {
        company_id: wallet.companyId,
        payment_account_id: wallet.id,
        direction: unit("Inbound"),
        partner_type: unit("Customer"),
        partner_id: customerId,
        external_reference: some(reference.replace(/-/g, "_")),
        gross_external_amount: fromMinor(1_000),
        settlement_amount: fromMinor(1_000),
        net_account_amount: fromMinor(1_000),
        currency_id: wallet.currencyId,
        occurred_at: none,
        source_entity: none,
        source_entity_id: none,
        evidence_document_ids: [],
        metadata: some(JSON.stringify({ test: "mobile-money-payments", marker, duplicate: true })),
      },
    ])
    expect(duplicate.ok).toBe(false)
    expect(duplicate.error ?? "").toMatch(/duplicate external reference/i)

    const alternateWalletId = await createWallet(
      page,
      organizationId,
      wallet,
      smokeName("mtn-duplicate-distinct-account"),
    )
    const distinctScopeTransactionId = await createTransaction(page, organizationId, {
      companyId: wallet.companyId,
      paymentAccountId: alternateWalletId,
      partnerId: customerId,
      partnerType: "Customer",
      direction: "Inbound",
      currencyId: wallet.currencyId,
      reference,
      grossMinor: 1_000,
      settlementMinor: 1_000,
      netMinor: 1_000,
      marker,
    })
    expect(distinctScopeTransactionId).toBeGreaterThan(0)

    const branchCompanyId = await createBranchCompany(
      page,
      organizationId,
      wallet.currencyId,
      smokeName("payment-branch"),
    )
    const crossCompany = await callReducerBffResult(page, "create_payment_transaction", [
      organizationId,
      {
        company_id: branchCompanyId,
        payment_account_id: wallet.id,
        direction: unit("Inbound"),
        partner_type: unit("Customer"),
        partner_id: customerId,
        external_reference: some(smokeName("mtn-cross-company")),
        gross_external_amount: fromMinor(1_000),
        settlement_amount: fromMinor(1_000),
        net_account_amount: fromMinor(1_000),
        currency_id: wallet.currencyId,
        occurred_at: none,
        source_entity: none,
        source_entity_id: none,
        evidence_document_ids: [],
        metadata: some(JSON.stringify({ test: "mobile-money-payments", marker, scope: "branch" })),
      },
    ])
    expect(crossCompany.ok).toBe(false)
    expect(crossCompany.error ?? "").toMatch(/different organization or company/i)

    const betaOrganizationId = await createSecondOrganization(
      page,
      organizationId,
      wallet.currencyId,
      smokeName("payment-org-beta"),
    )
    const crossTenant = await callReducerBffResult(page, "create_payment_transaction", [
      betaOrganizationId,
      {
        company_id: wallet.companyId,
        payment_account_id: wallet.id,
        direction: unit("Inbound"),
        partner_type: unit("Customer"),
        partner_id: customerId,
        external_reference: some(smokeName("mtn-cross-tenant")),
        gross_external_amount: fromMinor(1_000),
        settlement_amount: fromMinor(1_000),
        net_account_amount: fromMinor(1_000),
        currency_id: wallet.currencyId,
        occurred_at: none,
        source_entity: none,
        source_entity_id: none,
        evidence_document_ids: [],
        metadata: some(JSON.stringify({ test: "mobile-money-payments", marker, scope: "tenant" })),
      },
    ])
    expect(crossTenant.ok).toBe(false)
    expect(crossTenant.error ?? "").toMatch(
      /organization scope mismatch|different organization or company|permission denied/i,
    )
  })

  test("P1-PAY-03 records a supplier fee and reversal as a compensating transaction without mutating the original", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const wallet = await fetchPrimaryWallet(page)
    const supplierId = await fetchPartnerId(page, "Globex Corp", "supplier")
    const reference = smokeName("mtn-supplier")
    const transactionId = await createTransaction(page, organizationId, {
      companyId: wallet.companyId,
      paymentAccountId: wallet.id,
      partnerId: supplierId,
      partnerType: "Supplier",
      direction: "Outbound",
      currencyId: wallet.currencyId,
      reference,
      grossMinor: SUPPLIER_SETTLEMENT_MINOR + SUPPLIER_FEE_MINOR,
      settlementMinor: SUPPLIER_SETTLEMENT_MINOR,
      netMinor: SUPPLIER_SETTLEMENT_MINOR,
      marker: reference,
    })

    await callReducerBff(page, "create_payment_fee", [
      organizationId,
      {
        company_id: wallet.companyId,
        payment_transaction_id: transactionId,
        bearer: unit("Supplier"),
        amount: fromMinor(SUPPLIER_FEE_MINOR),
        currency_id: wallet.currencyId,
        fee_account_id: none,
        tax_account_id: none,
        tax_amount: 0,
        provider_reference: some(`${reference}-FEE`),
        metadata: some(JSON.stringify({ test: "mobile-money-payments", reference })),
      },
    ])
    const fee = await waitForRow(
      page,
      "payment-fees",
      (row) => idOf(field(row, "paymentTransactionId", "payment_transaction_id")) === transactionId,
      `supplier fee for ${reference}`,
    )
    expect(numberOf(field(fee, "amount"))).toBe(fromMinor(SUPPLIER_FEE_MINOR))
    expect(enumTag(field(fee, "bearer"))).toBe("Supplier")

    await callReducerBff(page, "post_payment_transaction", [organizationId, transactionId])
    const originalBeforeReversal = await waitForRow(
      page,
      "payment-transactions",
      (row) => idOf(field(row, "id")) === transactionId && enumTag(field(row, "status")) === "Posted",
      `posted supplier payment ${reference}`,
    )
    const originalPaymentId = idOf(field(originalBeforeReversal, "accountPaymentId", "account_payment_id"))
    expect(originalPaymentId).toBeGreaterThan(0)

    await callReducerBff(page, "reverse_payment_transaction", [
      organizationId,
      transactionId,
      {
        company_id: wallet.companyId,
        reason: some("Synthetic provider reversal for P1-PAY-03"),
        metadata: some(JSON.stringify({ test: "mobile-money-payments", reference, correction: true })),
      },
    ])

    const originalAfterReversal = await waitForRow(
      page,
      "payment-transactions",
      (row) => idOf(field(row, "id")) === transactionId && enumTag(field(row, "status")) === "Reversed",
      `reversed original payment ${reference}`,
    )
    expect(idOf(field(originalAfterReversal, "accountPaymentId", "account_payment_id"))).toBe(
      originalPaymentId,
    )
    expect(numberOf(field(originalAfterReversal, "settlementAmount", "settlement_amount"))).toBe(
      fromMinor(SUPPLIER_SETTLEMENT_MINOR),
    )

    const reversal = await waitForRow(
      page,
      "payment-reversals",
      (row) => idOf(field(row, "originalTransactionId", "original_transaction_id")) === transactionId,
      `payment reversal ${reference}`,
    )
    const correctingTransactionId = idOf(
      field(reversal, "correctingTransactionId", "correcting_transaction_id"),
    )
    if (correctingTransactionId == null) throw new Error("payment reversal has no correcting transaction id")

    const correcting = await waitForRow(
      page,
      "payment-transactions",
      (row) => idOf(field(row, "id")) === correctingTransactionId,
      `correcting payment transaction ${reference}`,
    )
    expect(enumTag(field(correcting, "status"))).toBe("Posted")
    expect(enumTag(field(correcting, "direction"))).toBe("Inbound")
    expect(idOf(field(correcting, "accountPaymentId", "account_payment_id"))).toBeGreaterThan(0)
    expect(idOf(field(correcting, "accountPaymentId", "account_payment_id"))).not.toBe(
      originalPaymentId,
    )

    const originalFeeAfterReversal = await waitForRow(
      page,
      "payment-fees",
      (row) => idOf(field(row, "id")) === idOf(field(fee, "id")),
      `immutable original fee for ${reference}`,
    )
    expect(idOf(field(originalFeeAfterReversal, "paymentTransactionId", "payment_transaction_id"))).toBe(
      transactionId,
    )
    expect(numberOf(field(originalFeeAfterReversal, "amount"))).toBe(fromMinor(SUPPLIER_FEE_MINOR))

    await waitForAudit(page, "payment_transaction", transactionId, "POST")
    const reversalId = idOf(field(reversal, "id"))
    if (reversalId == null) throw new Error("payment reversal has no id")
    await waitForAudit(page, "payment_reversal", reversalId, "CREATE")
  })
})
