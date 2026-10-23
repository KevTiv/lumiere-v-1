import { expect, test, type Page, type Request } from "@playwright/test"
import { randomUUID } from "node:crypto"

import {
  fetchDefaultCompanyId,
  fetchAccountIdByCode,
  fetchSessionOrganizationId,
  gotoModule,
  openAccountingTab,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

function timestampNow() {
  return { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 }
}

/**
 * Trusted fixture call that posts already SATS-encoded args unchanged. The
 * shared `callReducerOwner` re-encodes the params struct, and SpacetimeDB
 * rejected that body for these statement reducers ("trailing comma"), while the
 * hand-encoded COV-08d asset fixture (not re-encoded) is accepted.
 */
async function callOwnerRaw(reducer: string, args: unknown[]): Promise<void> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error(`trusted fixture call ${reducer} requires STDB_MODULE and STDB_SERVER_TOKEN`)
  const response = await fetch(`${host}/v1/database/${moduleName}/call/${reducer}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`trusted fixture reducer ${reducer} failed (${response.status}): ${await response.text()}`)
  }
}

async function queryRows(page: Page, resource: string): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Array<Record<string, unknown>> }).data ?? []
}

async function replayOperationAs(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function fetchBankLine(page: Page, lineId: number) {
  const row = (await queryRows(page, "bank-statement-lines")).find(
    (candidate) => scalarQueryId(candidate.id) === lineId,
  )
  if (!row) throw new Error(`bank statement line not found: ${lineId}`)
  return {
    id: lineId,
    statementId: scalarQueryId(row.statementId ?? row.statement_id),
    isReconciled: row.isReconciled ?? row.is_reconciled,
    moveIds: Array.isArray(row.moveIds ?? row.move_ids)
      ? ((row.moveIds ?? row.move_ids) as unknown[]).map(scalarQueryId)
      : [],
    amountResidual: Number(row.amountResidual ?? row.amount_residual),
  }
}

test.describe("COV-08b exact bank statement reconciliation", { tag: ["@p0", "@cov08", "@cov08b"] }, () => {
  test("reconciles one exact line and preserves it on stale and denied replay", async ({ browser, page }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const journals = await queryRows(page, "account-journals")
    const journal = journals.find((row) => {
      const tag = row.type && typeof row.type === "object" ? (row.type as { tag?: unknown }).tag : row.type
      return scalarQueryId(row.companyId ?? row.company_id) === companyId && String(tag).toLowerCase() === "bank"
    })
    const journalId = scalarQueryId(journal?.id)
    const company = (await queryRows(page, "companies")).find((row) => scalarQueryId(row.id) === companyId)
    const currencyId =
      scalarQueryId(journal?.currencyId ?? journal?.currency_id) ??
      scalarQueryId(company?.currencyId ?? company?.currency_id)
    if (journalId == null || currencyId == null) throw new Error("seeded bank journal is required")

    // Setup a dedicated posted receivable rather than borrowing an arbitrary
    // seeded line, which may be draft, already linked, or used by another spec.
    const accounts = await Promise.all(["1100", "4000", "5000", "1400"].map((code) => fetchAccountIdByCode(page, code)))
    const salesJournalId = scalarQueryId(journals.find((row) =>
      scalarQueryId(row.companyId ?? row.company_id) === companyId && row.code === "INV",
    )?.id)
    // Other specs create suppliers in the same company. Inbound settlement
    // requires a customer even though the trusted invoice fixture accepts a
    // general contact; keep this positive fixture independent of read order.
    const partnerId = scalarQueryId((await queryRows(page, "contacts")).find((row) =>
      scalarQueryId(row.companyId ?? row.company_id) === companyId &&
      (row.isCustomer ?? row.is_customer) === true,
    )?.id)
    if (salesJournalId == null || partnerId == null) throw new Error("bank-link invoice fixture lookups missing")
    const invoiceReference = smokeName("cov08b-invoice")
    await callOwnerRaw("create_manual_account_invoice", [organizationId, {
      idempotency_key: randomUUID().replaceAll("-", ""), company_id: companyId,
      move_type: { outInvoice: [] }, journal_id: salesJournalId, partner_id: partnerId,
      counterpart_account_id: accounts[0], currency_id: currencyId,
      date: timestampNow(), invoice_date: timestampNow(),
      invoice_date_due: { none: [] }, invoice_payment_term_id: { none: [] },
      ref: { some: invoiceReference }, payment_reference: { none: [] }, metadata: { none: [] },
      lines: [{ account_id: accounts[1], name: invoiceReference, quantity: 1, price_unit: 25, discount: 0, tax_ids: [], product_id: { none: [] } }],
    }])
    // The governed move projection omits the optional reference. Resolve the
    // exact fixture through its unique, company-bound revenue line instead.
    const invoiceLines = (await queryRows(page, "account-move-lines")).filter((row) =>
      row.name === invoiceReference &&
      scalarQueryId(row.companyId ?? row.company_id) === companyId &&
      scalarQueryId(row.accountId ?? row.account_id) === accounts[1],
    )
    expect(invoiceLines).toHaveLength(1)
    const moveId = scalarQueryId(invoiceLines[0]?.moveId ?? invoiceLines[0]?.move_id)
    if (moveId == null) throw new Error("bank-link fixture invoice not found")
    await callOwnerRaw("post_invoice", [organizationId, moveId, accounts[2], accounts[3]])
    const moveLine = (await queryRows(page, "account-move-lines")).find((row) =>
      scalarQueryId(row.moveId ?? row.move_id) === moveId && scalarQueryId(row.accountId ?? row.account_id) === accounts[0],
    )
    const moveLineId = scalarQueryId(moveLine?.id)
    if (moveLineId == null) throw new Error("seeded company move line is required")

    const statementName = smokeName("cov08b-statement")
    // Setup only: statement and line are fixture data, created with the
    // trusted owner call (the session compat route returns a redacted 500 for
    // these accounting fixtures). Reconciliation is driven through the UI below.
    await callOwnerRaw("create_account_bank_statement", [
      organizationId,
      companyId,
      journalId,
      // Explicit SATS options: Option fields must be `{ some }` / `{ none: [] }`.
      {
        name: { some: statementName },
        reference: { some: "COV-08B" },
        date: { some: timestampNow() },
        balance_start: 0,
        currency_id: currencyId,
        metadata: { none: [] },
      },
    ])
    const statement = (await queryRows(page, "bank-statements")).find((row) => row.name === statementName)
    const statementId = scalarQueryId(statement?.id)
    if (statementId == null) throw new Error("created bank statement not found")

    await callOwnerRaw("create_account_bank_statement_line", [
      organizationId,
      companyId,
      statementId,
      {
        date: timestampNow(),
        amount: 25,
        amount_currency: 25,
        currency_id: { some: currencyId },
        foreign_currency_id: { none: [] },
        partner_id: { none: [] },
        bank_account_id: { none: [] },
        account_number: { none: [] },
        move_id: { none: [] },
        is_reconciled: false,
        transaction_type: { some: "manual" },
        move_ids: [],
        payment_ids: [],
        amount_residual: 25,
        auto_reconcile_ids: [],
        metadata: { none: [] },
      },
    ])
    const line = (await queryRows(page, "bank-statement-lines")).find(
      (row) => scalarQueryId(row.statementId ?? row.statement_id) === statementId,
    )
    const lineId = scalarQueryId(line?.id)
    if (lineId == null) throw new Error("created bank statement line not found")

    await gotoModule(page, "accounting")
    await openAccountingTab(page, "bank-statements")
    const row = page.getByTestId(`entity-row-${statementId}`)
    await expect(row).toContainText(statementName)
    await row.click()
    await page.getByRole("tab", { name: "Reconcile", exact: true }).click()
    await page.getByRole("button", { name: "Manual reconcile", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: /Bank statement/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Focus line" }).click()
    const desk = dialog.getByTestId("reconciliation-workbench")
    await expect(desk.getByTestId(`reconciliation-candidate-${moveLineId}`)).toBeVisible()
    await desk.getByTestId(`reconciliation-candidate-${moveLineId}`).getByRole("checkbox").check()
    await desk.getByRole("checkbox", { name: /I reviewed the statement/ }).check()
    await expect(desk.getByTestId("reconciliation-confirm")).toBeEnabled()

    const [accepted] = await Promise.all([
      page.waitForResponse(
        (response) => matchesOperationResponse(response, "reconcile_account_bank_statement_line"),
        { timeout: 30_000 },
      ),
      desk.getByTestId("reconciliation-confirm").click(),
    ])
    expect(accepted.ok(), `Reconciliation HTTP ${accepted.status()}: ${await accepted.text()}`).toBe(true)
    await expect.poll(() => fetchBankLine(page, lineId)).toEqual({
      id: lineId,
      statementId,
      isReconciled: true,
      moveIds: [moveLineId],
      amountResidual: 0,
    })
    const acceptedEffect = await fetchBankLine(page, lineId)
    // Confirmation now proves actual invoice and payment settlement.
    const invoiceAfter = (await queryRows(page, "account-moves")).find((row) => scalarQueryId(row.id) === moveId)
    expect(Number(invoiceAfter?.amountResidual ?? invoiceAfter?.amount_residual)).toBe(0)
    const settledLine = (await queryRows(page, "bank-statement-lines")).find((row) => scalarQueryId(row.id) === lineId)
    const paymentIds = settledLine?.paymentIds ?? settledLine?.payment_ids
    expect(Array.isArray(paymentIds) ? paymentIds.length : 0).toBe(1)
    const paymentId = scalarQueryId((paymentIds as unknown[])[0])
    const paymentAfter = (await queryRows(page, "account-payments")).find((row) => scalarQueryId(row.id) === paymentId)
    expect(Number(paymentAfter?.amount)).toBe(25)
    const paymentMoveId = scalarQueryId(paymentAfter?.moveId ?? paymentAfter?.move_id)
    expect(paymentMoveId).not.toBeNull()
    const clearing = (await queryRows(page, "account-move-lines")).filter((row) =>
      scalarQueryId(row.moveId ?? row.move_id) === paymentMoveId
      && ["receivable", "payable"].includes(String(row.accountInternalType ?? row.account_internal_type).toLowerCase()),
    )
    expect(clearing).toHaveLength(1)
    expect(Number(clearing[0]?.amountResidual ?? clearing[0]?.amount_residual)).toBe(0)

    const stale = await replayOperationAs(page, accepted.request())
    expect(stale.status()).toBe(422)
    expect(await fetchBankLine(page, lineId)).toEqual(acceptedEffect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replayOperationAs(readerPage, accepted.request())
      expect(denied.status()).toBe(403)
      expect(await fetchBankLine(page, lineId)).toEqual(acceptedEffect)
    } finally {
      await readerContext.close()
    }
  })
})
