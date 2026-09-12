import { expect, test } from "@playwright/test"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"

import {
  callReducerBff,
  callReducerBffResult,
  fetchAccountIdByCode,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  smokeName,
} from "./helpers"
import {
  MINOR_SCALE,
  RECEIPT_ALLOCATIONS_MINOR,
  SUPPLIER_SETTLEMENT_MINOR,
  SUPPLIER_FEE_MINOR,
  none,
  some,
  unit,
  POSTABLE_MOVE_DATE,
  moveLineBase,
  fromMinor,
  unwrapQueryValue,
  field,
  idOf,
  numberOf,
  enumTag,
  queryRows,
  waitForRow,
  fetchPrimaryWallet,
  fetchPartnerId,
  createWallet,
  createTransaction,
  fetchJournalIdByCode,
  createPostedReceivableLine,
  createAllocationInvoices,
  waitForAudit,
  createBranchCompany,
  type QueryRow,
  type Wallet,
} from "./payment-fixtures"

/**
 * Phase-1 payment scenarios use the operational payment reducers through the
 * authenticated BFF. The current Accounting UI exposes legacy AccountPayment,
 * not PaymentTransaction, so this spec deliberately verifies the API boundary
 * and read-model evidence used by the payment workspace.
 *
 * The baseline dev fixture supplies the primary company, MTN wallet, and customer /
 * supplier contacts. The allocation test creates its own posted receivable lines.
 * Every mutable row has a scenario-specific name, reference, or metadata marker.
 */


test.describe("Mobile-money payment transactions", { tag: "@dev-fixture" }, () => {
  test("P1-PAY-01 posts a partial incoming receipt across two invoices with allocation and audit evidence", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const wallet = await fetchPrimaryWallet(page)
    expect(await fetchDefaultCompanyId(page)).toBe(wallet.companyId)
    const customerId = await fetchPartnerId(page, "Acme Corporation", "customer")
    const receivableLines = await createAllocationInvoices(
      page,
      organizationId,
      wallet.companyId,
      customerId,
    )
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
      (row) =>
        idOf(field(row, "id")) === transactionId &&
        enumTag(field(row, "status")).toLowerCase() === "posted",
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
        occurred_at: some(stbTimestampFromDate(new Date())),
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
        occurred_at: some(stbTimestampFromDate(new Date())),
        source_entity: none,
        source_entity_id: none,
        evidence_document_ids: [],
        metadata: some(JSON.stringify({ test: "mobile-money-payments", marker, scope: "branch" })),
      },
    ])
    expect(crossCompany.ok).toBe(false)
    expect(crossCompany.error ?? "").toMatch(/different organization or company/i)

    const foreignOrganizationId = organizationId + 9_000_000
    const crossTenant = await callReducerBffResult(page, "create_payment_transaction", [
      foreignOrganizationId,
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
        occurred_at: some(stbTimestampFromDate(new Date())),
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
    const feeAccountId = await fetchAccountIdByCode(page, "5000")
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
        fee_account_id: some(feeAccountId),
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
    expect(enumTag(field(fee, "bearer")).toLowerCase()).toBe("supplier")

    await callReducerBff(page, "post_payment_transaction", [organizationId, transactionId])
    const originalBeforeReversal = await waitForRow(
      page,
      "payment-transactions",
      (row) =>
        idOf(field(row, "id")) === transactionId &&
        enumTag(field(row, "status")).toLowerCase() === "posted",
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
      (row) =>
        idOf(field(row, "id")) === transactionId &&
        enumTag(field(row, "status")).toLowerCase() === "reversed",
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
    expect(enumTag(field(correcting, "status")).toLowerCase()).toBe("posted")
    expect(enumTag(field(correcting, "direction")).toLowerCase()).toBe("inbound")
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
