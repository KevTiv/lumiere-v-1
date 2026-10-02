import { expect, test, type Page } from "@playwright/test"

import {
  chooseSelectOptionByLabel,
  fetchAccountSelectLabelByInternalType,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-12 — see docs/plan/erp-cov12-subscription-invoice-run-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const READER_EMAIL = "fixture.reader@example.test"
const SEEDED_SUBSCRIPTION_CODE = "SUB-ACME-001"

type Row = Record<string, unknown>

async function rows(page: Page, path: string): Promise<Row[]> {
  const response = await page.request.get(path)
  if (!response.ok()) throw new Error(`${path} failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

function tag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return String(value ?? "")
}

/** Exact runs for one subscription, keyed by their unique billing-run key. */
async function runSnapshots(page: Page, subscriptionId: number) {
  return (await rows(page, "/api/query/subscription-billing-runs"))
    .filter((row) => scalarQueryId(row.subscriptionId ?? row.subscription_id) === subscriptionId)
    .map((row) => ({
      id: scalarQueryId(row.id),
      key: String(row.billingRunKey ?? row.billing_run_key ?? ""),
      organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
      companyId: scalarQueryId(row.companyId ?? row.company_id),
      subscriptionId,
      invoiceMoveId: scalarQueryId(row.invoiceMoveId ?? row.invoice_move_id),
    }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

async function moveCount(page: Page): Promise<number> {
  return (await rows(page, "/api/query/account-moves")).length
}

test.describe("COV-12 exact subscription invoice run", { tag: ["@p0", "@cov12"] }, () => {
  test("operator generates one run; replay is idempotent and the reader is denied", async ({ browser, page }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    const subscriptions = (await rows(page, "/api/query/subscriptions")).filter((row) => row.code === SEEDED_SUBSCRIPTION_CODE)
    expect(subscriptions, `seeded subscription ${SEEDED_SUBSCRIPTION_CODE} required`).toHaveLength(1)
    const subscription = subscriptions[0]!
    const subscriptionId = scalarQueryId(subscription.id)!
    expect(tag(subscription.state)).toBe("active")
    expect(scalarQueryId(subscription.companyId ?? subscription.company_id)).toBe(companyId)

    const incomeLabel = await fetchAccountSelectLabelByInternalType(page, "income")
    const receivableLabel = await fetchAccountSelectLabelByInternalType(page, "receivable")
    const journals = await rows(page, "/api/query/account-journals")
    const journal = journals.find((row) => tag(row.type ?? row.type_ ?? row.journalType) === "Sale") ?? journals[0]
    expect(journal).toBeTruthy()
    const journalLabel = journal!.code && journal!.name ? `${journal!.code} — ${journal!.name}` : String(journal!.name ?? journal!.code)

    // A unique key per execution: the run is unique per (subscription, key).
    const billingRunKey = smokeName("cov12-run")
    const runsBefore = await runSnapshots(page, subscriptionId)
    expect(runsBefore.map((run) => run.key)).not.toContain(billingRunKey)

    // ── Operator path: Generate invoice from the subscriptions toolbar ─────
    await gotoModule(page, "/subscriptions", "subscriptions")
    await selectModuleTab(page, "subscriptions", "subscriptions")
    await selectEntityRowById(page, subscriptionId)
    await page.getByTestId("entity-action-gen-inv").click()
    await expect(page.getByTestId("form-modal-generate-subscription-invoice")).toBeVisible({ timeout: 15_000 })
    await fillField(page, "invoiceDate", isoDate(0))
    await chooseSelectOptionByLabel(page, "journalId", journalLabel)
    await chooseSelectOptionByLabel(page, "incomeAccountId", incomeLabel)
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
    await fillField(page, "billingRunKey", billingRunKey)
    const [generated] = await Promise.all([
      page.waitForResponse((candidate) => matchesOperationResponse(candidate, "generate_subscription_invoice"), {
        timeout: 45_000,
      }),
      submitForm(page, "generate-subscription-invoice"),
    ])
    expect(generated.ok()).toBe(true)

    // ── Exact effect: one run for this key, pointing at one scoped invoice ─
    await expect
      .poll(async () => (await runSnapshots(page, subscriptionId)).filter((run) => run.key === billingRunKey).length, {
        timeout: 60_000,
      })
      .toBe(1)
    const runsAfter = await runSnapshots(page, subscriptionId)
    expect(runsAfter).toHaveLength(runsBefore.length + 1)
    const run = runsAfter.find((candidate) => candidate.key === billingRunKey)!
    expect(run).toMatchObject({ organizationId, companyId, subscriptionId })
    expect(run.invoiceMoveId).toBeGreaterThan(0)
    const invoices = (await rows(page, "/api/query/account-moves")).filter((row) => scalarQueryId(row.id) === run.invoiceMoveId)
    expect(invoices).toHaveLength(1)
    expect(scalarQueryId(invoices[0]!.companyId ?? invoices[0]!.company_id)).toBe(companyId)

    // ── Replay (scheduler/operator retry) must not bill twice ──────────────
    const movesAfterRun = await moveCount(page)
    const replayed = await page.request.post(new URL(generated.request().url()).pathname, {
      headers: { "Content-Type": "application/json" },
      data: generated.request().postDataJSON(),
    })
    expect(replayed.ok()).toBe(true)
    expect(await runSnapshots(page, subscriptionId)).toEqual(runsAfter)
    expect(await moveCount(page)).toBe(movesAfterRun)

    // ── Denied reader: 403 and an unchanged snapshot ───────────────────────
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, READER_EMAIL, PERSONA_PASSWORD)
      const denied = await readerPage.request.post(new URL(generated.request().url()).pathname, {
        headers: { "Content-Type": "application/json" },
        data: generated.request().postDataJSON(),
      })
      expect(denied.status()).toBe(403)
      expect(await runSnapshots(page, subscriptionId)).toEqual(runsAfter)
      expect(await moveCount(page)).toBe(movesAfterRun)
    } finally {
      await readerContext.close()
    }
  })
})
