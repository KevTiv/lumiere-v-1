import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  callReducerBffResult,
  fetchAccountIdByCode,
  fetchContactIdByName,
  fetchSessionOrganizationId,
  smokeName,
} from "./helpers"
import {
  createPostedReceivableLine,
  createTransaction,
  enumTag,
  fetchJournalIdByCode,
  fetchPartnerId,
  fetchPrimaryWallet,
  field,
  fromMinor,
  idOf,
  none,
  numberOf,
  queryRows,
  some,
  unit,
  waitForRow,
  type QueryRow,
  type Wallet,
} from "./payment-fixtures"
import {
  CAPABILITIES,
  CAPABILITY_PENDING,
  PERSONAS,
  auditCount,
  browserPost,
  callRaw,
  callRawOk,
  expectKnownDefect,
  loseNextResponse,
  openActorPages,
  openOwnerPages,
  pendingContract,
  pretenantTags,
  provisionActor,
  requireCapability,
} from "./pretenant-support"

/**
 * MONEY / IDEMPOTENCY certification through the authenticated BFF with real request concurrency.
 * Reducer-level interleavings, precision and statement staging live in
 * spacetimedb/tests/pretenant/payments_cert.rs and state_machine_cert.rs.
 */

const toMinor = (value: unknown) => Math.round((numberOf(value) ?? Number.NaN) * 100)

type Setup = { organizationId: number; wallet: Wallet; customerId: number }

async function paymentSetup(page: Page, customerName = "Acme Corporation"): Promise<Setup> {
  return {
    organizationId: await fetchSessionOrganizationId(page),
    wallet: await fetchPrimaryWallet(page),
    customerId: await fetchPartnerId(page, customerName, "customer"),
  }
}

async function receivableLineId(page: Page, s: Setup, minor: number, marker: string): Promise<number> {
  const line = await createPostedReceivableLine(page, {
    organizationId: s.organizationId,
    companyId: s.wallet.companyId,
    partnerId: s.customerId,
    journalId: await fetchJournalIdByCode(page, "INV"),
    receivableAccountId: await fetchAccountIdByCode(page, "1100"),
    revenueAccountId: await fetchAccountIdByCode(page, "4000"),
    amount: fromMinor(minor),
    reference: smokeName(marker),
  })
  const id = idOf(field(line, "id"))
  if (id == null) throw new Error(`receivable line ${marker} has no id`)
  return id
}

async function draftReceipt(page: Page, s: Setup, minor: number, marker: string): Promise<number> {
  const reference = smokeName(marker)
  return createTransaction(page, s.organizationId, {
    companyId: s.wallet.companyId,
    paymentAccountId: s.wallet.id,
    partnerId: s.customerId,
    partnerType: "Customer",
    direction: "Inbound",
    currencyId: s.wallet.currencyId,
    reference,
    grossMinor: minor,
    settlementMinor: minor,
    netMinor: minor,
    marker: reference,
  })
}

async function waitPosted(page: Page, transactionId: number): Promise<QueryRow> {
  return waitForRow(
    page,
    "payment-transactions",
    (row) => idOf(field(row, "id")) === transactionId && enumTag(field(row, "status")).toLowerCase() === "posted",
    `posted transaction ${transactionId}`,
  )
}

async function postedReceipt(page: Page, s: Setup, minor: number, marker: string): Promise<number> {
  const id = await draftReceipt(page, s, minor, marker)
  await callReducerBff(page, "post_payment_transaction", [s.organizationId, id])
  await waitPosted(page, id)
  return id
}

function allocationArgs(s: Setup, transactionId: number, lineId: number, minor: number, key: string) {
  return [
    s.organizationId,
    {
      idempotency_key: key,
      company_id: s.wallet.companyId,
      payment_transaction_id: transactionId,
      allocated_move_line_id: lineId,
      allocated_amount: fromMinor(minor),
      currency_id: s.wallet.currencyId,
      write_off_amount: 0,
      write_off_account_id: none,
      metadata: some(JSON.stringify({ test: "pretenant", key })),
    },
  ]
}

async function allocations(page: Page, transactionId: number): Promise<QueryRow[]> {
  return (await queryRows(page, "payment-reconciliations")).filter(
    (row) => idOf(field(row, "paymentTransactionId", "payment_transaction_id")) === transactionId,
  )
}

async function netAllocatedMinor(page: Page, transactionId: number): Promise<number> {
  return (await allocations(page, transactionId)).reduce(
    (sum, row) => sum + toMinor(field(row, "allocatedAmount", "allocated_amount")),
    0,
  )
}

test.describe("Pre-tenant payment adversarial", { tag: pretenantTags("@payments", "@dev-fixture") }, () => {
  test("PAY-01-E2E concurrent cashier allocations never exceed the payment", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const s = await paymentSetup(page)
    const lineA = await receivableLineId(page, s, 8_000, "pt-pay01-a")
    const lineB = await receivableLineId(page, s, 5_000, "pt-pay01-b")
    const payment = await postedReceipt(page, s, 10_000, "pt-pay01-receipt")

    const cashiers = await openOwnerPages(browser, 2)
    let results: Awaited<ReturnType<typeof callReducerBffResult>>[]
    try {
      results = await Promise.all([
        callReducerBffResult(cashiers.pages[0], "allocate_payment_transaction", allocationArgs(s, payment, lineA, 8_000, `pt-pay01-a-${payment}`)),
        callReducerBffResult(cashiers.pages[1], "allocate_payment_transaction", allocationArgs(s, payment, lineB, 5_000, `pt-pay01-b-${payment}`)),
      ])
    } finally {
      await cashiers.close()
    }
    const committed = results.filter((result) => result.ok).length
    expect(committed, results.map((r) => r.error).join(" | ")).toBe(1)
    const expected = results[0].ok ? 8_000 : 5_000
    await expect.poll(() => netAllocatedMinor(page, payment)).toBe(expected)

    for (const row of await allocations(page, payment)) {
      const before = toMinor(field(row, "residualBefore", "residual_before"))
      const amount = toMinor(field(row, "allocatedAmount", "allocated_amount"))
      const after = toMinor(field(row, "residualAfter", "residual_after"))
      expect(after).toBe(before - amount)
      expect(after).toBeGreaterThanOrEqual(0)
    }
    await page.reload()
    expect(await netAllocatedMinor(page, payment)).toBe(expected)
  })

  test("PAY-02-E2E five near-simultaneous post submissions create one ledger effect", async ({ page }) => {
    test.setTimeout(120_000)
    const s = await paymentSetup(page)
    const transactionId = await draftReceipt(page, s, 4_200, "pt-pay02")
    const results = await Promise.all(
      Array.from({ length: 5 }, () => callReducerBffResult(page, "post_payment_transaction", [s.organizationId, transactionId])),
    )
    expect(results.some((result) => result.ok), results.map((r) => r.error).join(" | ")).toBe(true)
    const posted = await waitPosted(page, transactionId)
    const ledgerPaymentId = idOf(field(posted, "accountPaymentId", "account_payment_id"))
    expect(ledgerPaymentId).toBeGreaterThan(0)
    await expect.poll(() => auditCount(page, "payment_transaction", transactionId, "POST")).toBe(1)

    await page.reload()
    expect(idOf(field(await waitPosted(page, transactionId), "accountPaymentId", "account_payment_id"))).toBe(ledgerPaymentId)

    await expectKnownDefect("PAY-03", "post retry after commit returns an error", () => {
      expect(results.every((result) => result.ok), results.map((r) => r.error).join(" | ")).toBe(true)
    })
  })

  test("PAY-06-E2E overpayment leaves explicit unapplied credit and no write-off", async ({ page }) => {
    test.setTimeout(120_000)
    const s = await paymentSetup(page)
    const line = await receivableLineId(page, s, 10_000, "pt-pay06-invoice")
    const payment = await postedReceipt(page, s, 12_000, "pt-pay06-receipt")

    const over = await callReducerBffResult(page, "allocate_payment_transaction", allocationArgs(s, payment, line, 12_000, `pt-pay06-over-${payment}`))
    expect(over.ok).toBe(false)
    expect(await allocations(page, payment)).toHaveLength(0)

    await callReducerBff(page, "allocate_payment_transaction", allocationArgs(s, payment, line, 10_000, `pt-pay06-exact-${payment}`))
    await expect.poll(() => netAllocatedMinor(page, payment)).toBe(10_000)
    const [row] = await allocations(page, payment)
    expect(toMinor(field(row, "writeOffAmount", "write_off_amount"))).toBe(0)
    expect(field(row, "writeOffMoveId", "write_off_move_id") ?? null).toBeNull()
    expect(toMinor(field(row, "residualAfter", "residual_after"))).toBe(0)

    const transaction = await waitPosted(page, payment)
    const unapplied = toMinor(field(transaction, "settlementAmount", "settlement_amount")) - (await netAllocatedMinor(page, payment))
    expect(unapplied).toBe(2_000)
  })

  test("PAY-PAYER-01 provider payer mismatch enters manual review", { tag: CAPABILITY_PENDING }, async ({ page }) => {
    await requireCapability(page, CAPABILITIES.providerPayerIdentity)
    pendingContract(
      CAPABILITIES.providerPayerIdentity,
      "PAY-PAYER-01",
      "an incoming provider payer phone that differs from the customer's mobile-money identity is held for manual review: no automatic allocation, no fraud assumption, reviewer decision audited",
    )
  })

  test("PERSONA-DIST-01 distributor credit sale, lost-response collection, reminder approval and correction", async ({ page, browser }) => {
    test.setTimeout(300_000)
    const persona = PERSONAS.distributor
    const marker = smokeName(`pt-${persona.key}`)
    const organizationId = await fetchSessionOrganizationId(page)
    const wallet = await fetchPrimaryWallet(page)

    // 1. Customer with phone + mobile-money identities.
    const customerName = `${persona.customer.name} ${marker}`
    await callReducerBff(page, "create_contact", [
      organizationId,
      {
        name: customerName,
        type: "company",
        companyId: wallet.companyId,
        isCustomer: true,
        isVendor: false,
        isEmployee: false,
        isProspect: false,
        isPartner: false,
        customerRank: 1,
        supplierRank: 0,
      },
    ])
    const customerId = await fetchContactIdByName(page, customerName)
    for (const [kind, phone] of [["primary", persona.customer.phone], ["mobileMoney", persona.customer.momoPhone]] as const) {
      await callRawOk(page, "create_contact_identity", [
        organizationId,
        { contact_id: customerId, company_id: none, kind: { [kind]: [] }, raw_value: phone, is_preferred: true, verification_state: none, metadata: some(marker) },
      ])
    }
    const s: Setup = { organizationId, wallet, customerId }

    // 2. Credit sale invoice.
    const line = await receivableLineId(page, s, persona.invoiceMinor, `${marker}-invoice`)

    // 3. Partial mobile-money collection; the committed post response is lost and the cashier retries.
    const receiptMinor = persona.partialPaymentMinor + 10_000
    const payment = await draftReceipt(page, s, receiptMinor, `${marker}-momo`)
    await page.goto("/accounting")
    const loss = await loseNextResponse(page, "/api/compat/reducer/post_payment_transaction")
    const lostAttempt = await browserPost(page, "/api/compat/reducer/post_payment_transaction", [organizationId, payment])
    expect(loss.lost()).toBe(true)
    expect(lostAttempt.status).toBe("network-error")
    await callRaw(page, "post_payment_transaction", [organizationId, payment])
    await waitPosted(page, payment)
    await expect.poll(() => auditCount(page, "payment_transaction", payment, "POST")).toBe(1)

    // 4. Allocate the partial amount (with a duplicate submission) and keep the rest as explicit credit.
    const key = `${marker}-allocation`
    await callReducerBff(page, "allocate_payment_transaction", allocationArgs(s, payment, line, persona.partialPaymentMinor, key))
    await callReducerBff(page, "allocate_payment_transaction", allocationArgs(s, payment, line, persona.partialPaymentMinor, key))
    await expect.poll(async () => (await allocations(page, payment)).length).toBe(1)
    const [allocation] = await allocations(page, payment)
    expect(toMinor(field(allocation, "residualAfter", "residual_after"))).toBe(persona.invoiceMinor - persona.partialPaymentMinor)
    expect(receiptMinor - (await netAllocatedMinor(page, payment))).toBe(10_000)

    // 5. Reminder batch approved by an independent approver.
    const approver = await provisionActor(page, `${persona.key}-approver`, ["message_batch:approve"])
    await callRawOk(page, "create_message_template", [
      organizationId,
      {
        company_id: none,
        key: `${marker}-reminder`,
        name: `${marker} reminder`,
        locale: "en",
        subject: some(`Invoice {{invoice_number}} ${marker}`),
        body_template: "Hello {{customer_name}}, invoice {{invoice_number}} is due.",
        allowed_variables: ["customer_name", "invoice_number"],
        applicable_channels: [{ sms: [] }],
        retention_classification: "operational",
        metadata: some(marker),
      },
    ])
    const template = await waitForRow(page, "message-templates", (row) => String(field(row, "subject") ?? "").includes(marker), `template ${marker}`)
    const invoiceId = idOf(field(await waitForRow(page, "account-move-lines", (row) => idOf(field(row, "id")) === line, "invoice line"), "moveId", "move_id"))
    await callRawOk(page, "create_invoice_reminder_batch", [
      organizationId,
      { company_id: some(wallet.companyId), template_id: idOf(field(template, "id")), channel: { sms: [] }, invoice_ids: [invoiceId], metadata: some(marker) },
    ])
    const batch = await waitForRow(page, "message-batches", (row) => idOf(field(row, "templateId", "template_id")) === idOf(field(template, "id")), `reminder ${marker}`)
    const batchId = idOf(field(batch, "id"))
    if (batchId == null) throw new Error("reminder batch has no id")
    expect(Number(field(batch, "recipientCount", "recipient_count"))).toBe(1)
    const approvers = await openActorPages(browser, [approver])
    try {
      const approval = await callRaw(approvers.pages[0], "review_message_batch", [organizationId, batchId, { approved: true, reason: some(marker) }])
      expect(approval.ok, approval.error).toBe(true)
    } finally {
      await approvers.close()
    }
    await expect.poll(() => auditCount(page, "message_batch", batchId, "APPROVE")).toBe(1)

    // 6. Payment correction: the provider reverses the collection.
    await callReducerBff(page, "reverse_payment_transaction", [
      organizationId,
      payment,
      { company_id: wallet.companyId, reason: some(`${marker} provider reversal`), metadata: some(JSON.stringify({ test: "pretenant" })) },
    ])
    await waitForRow(page, "payment-transactions", (row) => idOf(field(row, "id")) === payment && enumTag(field(row, "status")).toLowerCase() === "reversed", "reversed collection")
    await expect.poll(() => netAllocatedMinor(page, payment)).toBe(0)

    // 7. Audit read-back after refresh.
    await page.reload()
    expect(await auditCount(page, "payment_transaction", payment, "POST")).toBe(1)
    expect(await auditCount(page, "message_batch", batchId, "APPROVE")).toBe(1)
    const reversal = await waitForRow(page, "payment-reversals", (row) => idOf(field(row, "originalTransactionId", "original_transaction_id")) === payment, "reversal")
    expect(await auditCount(page, "payment_reversal", idOf(field(reversal, "id")) ?? -1, "CREATE")).toBe(1)
    expect(unit("Mtn")).toEqual({ mtn: [] })
  })
})
