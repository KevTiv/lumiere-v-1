import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerOwner,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

function timestampNow() {
  return { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 }
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

    const moveLine = (await queryRows(page, "account-move-lines")).find(
      (row) => scalarQueryId(row.companyId ?? row.company_id) === companyId,
    )
    const moveLineId = scalarQueryId(moveLine?.id)
    if (moveLineId == null) throw new Error("seeded company move line is required")

    const statementName = smokeName("cov08b-statement")
    // Setup only: statement and line are fixture data, created with the
    // trusted owner call (the session compat route returns a redacted 500 for
    // these accounting fixtures). Reconciliation is driven through the UI below.
    await callReducerOwner("create_account_bank_statement", [
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

    await callReducerOwner("create_account_bank_statement_line", [
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
    await page.getByTestId("module-tab-accounting-bank-statements").click()
    const row = page.getByTestId(`entity-row-${statementId}`)
    await expect(row).toContainText(statementName)
    await row.click()
    await page.getByRole("tab", { name: "Reconcile", exact: true }).click()
    await page.getByRole("button", { name: "Manual reconcile", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: /Bank statement/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Focus line" }).click()
    await dialog.locator("#manual-move-ids").fill(String(moveLineId))
    await dialog.locator("#manual-residual").fill("0")

    const [accepted] = await Promise.all([
      page.waitForResponse(
        (response) => matchesOperationResponse(response, "reconcile_account_bank_statement_line"),
        { timeout: 30_000 },
      ),
      dialog.getByRole("button", { name: "Reconcile (manual)" }).click(),
    ])
    expect(accepted.ok()).toBe(true)
    await expect.poll(() => fetchBankLine(page, lineId)).toEqual({
      id: lineId,
      statementId,
      isReconciled: true,
      moveIds: [moveLineId],
      amountResidual: 0,
    })
    const acceptedEffect = await fetchBankLine(page, lineId)

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
