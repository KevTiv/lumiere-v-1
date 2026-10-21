import { expect, test, type Page } from "@playwright/test"
import {
  selectModuleTab,
  chooseSelectOptionByLabel, fetchAccountSelectLabelByInternalType, fetchSalesInvoiceJournalLabel, fillField,
  gotoModule, isoDate, scalarQueryId, selectEntityRowById, signIn, smokeName, submitForm,
} from "./helpers"
import { clickCanonicalHandoff, openCanonicalHandoffs } from "./cov25-link-navigation"
import { matchesOperationResponse } from "./operation-response"

type Row = Record<string, unknown>
async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} must be readable`).toBe(true)
  return ((await response.json()) as { data: Row[] }).data
}
test.describe("COV-25 subscription invoices and canonical payment projection", { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
  test("multiple exact run invoice links survive refresh/back with payment relations available", async ({ page }) => {
    test.setTimeout(420_000)
    await signIn(page, "test@email.com", process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$")
    const subscriptions = (await rows(page, "subscriptions")).filter((row) => row.code === "SUB-ACME-001")
    expect(subscriptions).toHaveLength(1)
    const subscriptionId = scalarQueryId(subscriptions[0]?.id)
    const companyId = scalarQueryId(subscriptions[0]?.companyId ?? subscriptions[0]?.company_id)
    const organizationId = scalarQueryId(subscriptions[0]?.organizationId ?? subscriptions[0]?.organization_id)
    if (subscriptionId == null || companyId == null || organizationId == null) throw new Error("Seeded subscription is unavailable")
    const source = { module: "subscriptions", tab: "subscriptions", id: subscriptionId }
    const receivableLabel = await fetchAccountSelectLabelByInternalType(page, "receivable")
    const invoiceIds: number[] = []
    for (let index = 0; index < 2; index += 1) {
      const runKey = smokeName(`cov25-run-${index}`)
      await gotoModule(page, "/subscriptions", "subscriptions")
      await selectModuleTab(page, "subscriptions", "subscriptions")
      await selectEntityRowById(page, subscriptionId)
      await page.getByTestId("entity-action-gen-inv").click()
      await expect(page.getByTestId("form-modal-generate-subscription-invoice")).toBeVisible()
      await fillField(page, "invoiceDate", isoDate(0))
      await fillField(page, "billingRunKey", runKey)
      await chooseSelectOptionByLabel(page, "journalId", await fetchSalesInvoiceJournalLabel(page))
      await chooseSelectOptionByLabel(page, "incomeAccountId", await fetchAccountSelectLabelByInternalType(page, "income"))
      await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
      const [generated] = await Promise.all([
        page.waitForResponse((candidate) => matchesOperationResponse(candidate, "generate_subscription_invoice")),
        submitForm(page, "generate-subscription-invoice"),
      ])
      expect(generated.ok()).toBe(true)
      const exactRun = async () => (await rows(page, "subscription-billing-runs"))
        .filter((run) => (run.billingRunKey ?? run.billing_run_key) === runKey)
      await expect.poll(exactRun).toHaveLength(1)
      const [run] = await exactRun()
      expect(scalarQueryId(run!.subscriptionId ?? run!.subscription_id)).toBe(subscriptionId)
      expect(scalarQueryId(run!.organizationId ?? run!.organization_id)).toBe(organizationId)
      expect(scalarQueryId(run!.companyId ?? run!.company_id)).toBe(companyId)
      const invoiceId = scalarQueryId(run!.invoiceMoveId ?? run!.invoice_move_id)
      if (invoiceId == null) throw new Error("Billing run has no exact invoice_move_id")
      invoiceIds.push(invoiceId)
    }
    expect(new Set(invoiceIds).size).toBe(2)
    // 0..N is not resolved to an arbitrary “latest” invoice: click each exact result.
    for (const invoiceId of invoiceIds) {
      await clickCanonicalHandoff(page, source, `subscription-handoff-invoice-${invoiceId}`, { module: "accounting", tab: "journal-entries", id: invoiceId })
    }
    // Payment completion and mounted-cache convergence are exercised by COV-12.
    // This multi-run proof also verifies that the operator receives canonical relations.
    const scopedPayments = (await rows(page, "account-payments")).filter((row) =>
      scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
      scalarQueryId(row.companyId ?? row.company_id) === companyId)
    expect(scopedPayments.length, "fixture must expose payment rows").toBeGreaterThan(0)
    for (const payment of scopedPayments) {
      expect(Array.isArray(payment.reconciledInvoiceIds ?? payment.reconciled_invoice_ids)).toBe(true)
      expect(Array.isArray(payment.reconciledBillIds ?? payment.reconciled_bill_ids)).toBe(true)
    }
    const sheet = await openCanonicalHandoffs(page, source)
    await expect(sheet.getByTestId(`subscription-handoff-invoice-${invoiceIds[0]}`)).toBeVisible()
    await expect(sheet.getByTestId(`subscription-handoff-invoice-${invoiceIds[1]}`)).toBeVisible()
    await expect(sheet.getByTestId("subscription-handoff-payment-unavailable")).toHaveCount(0)
  })
})
