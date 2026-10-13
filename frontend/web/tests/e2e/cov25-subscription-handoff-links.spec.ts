import { expect, test, type Page } from "@playwright/test"
import {
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
function tag(value: unknown): string {
  if (value && typeof value === "object" && "tag" in value) return String((value as { tag?: unknown }).tag ?? "")
  return ""
}
async function labelByCode(page: Page, resource: "account-accounts" | "account-journals", code: string) {
  const row = (await rows(page, resource)).find((candidate) => String(candidate.code ?? "").toUpperCase() === code)
  if (!row) throw new Error(`${resource} code not found: ${code}`)
  const name = String(row.name ?? "")
  return name ? `${code} — ${name}` : code
}
/** Mirrors the pay-invoice select option label for one exact move. */
async function invoiceOptionLabel(page: Page, moveId: number) {
  const row = (await rows(page, "account-moves")).find((candidate) => scalarQueryId(candidate.id) === moveId)
  if (!row) throw new Error(`invoice move not found: ${moveId}`)
  const ref = String(row.ref ?? row.name ?? "").trim()
  const typeTag = tag(row.moveType)
  const suffix = typeTag ? ` (${typeTag})` : ""
  return ref ? `${ref}${suffix}` : `Move #${moveId}${suffix}`
}
test.describe("COV-25 subscription invoices and reconciled payments", { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
  test("multiple exact run invoice links and the reconciled payment link survive refresh/back", async ({ page }) => {
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
      await page.getByTestId("module-tab-subscriptions-subscriptions").click()
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
    // Pay the first exact invoice through the visible subscription action; the payment row's projected
    // reconciled_invoice_ids is the only relation used. No owner SQL, guessed payment or paid-state substitute.
    const paidInvoiceId = invoiceIds[0]!
    await gotoModule(page, "/subscriptions", "subscriptions")
    await page.getByTestId("module-tab-subscriptions-subscriptions").click()
    await selectEntityRowById(page, subscriptionId)
    await page.getByTestId("entity-action-pay-inv").click()
    await expect(page.getByTestId("form-modal-pay-subscription-invoice")).toBeVisible({ timeout: 15_000 })
    await chooseSelectOptionByLabel(page, "invoiceMoveId", await invoiceOptionLabel(page, paidInvoiceId))
    await chooseSelectOptionByLabel(page, "paymentJournalId", await labelByCode(page, "account-journals", "BNK"))
    await chooseSelectOptionByLabel(page, "bankAccountId", await labelByCode(page, "account-accounts", "1200"))
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
    await chooseSelectOptionByLabel(page, "cogsAccountId", await labelByCode(page, "account-accounts", "5000"))
    await chooseSelectOptionByLabel(page, "inventoryAccountId", await labelByCode(page, "account-accounts", "1400"))
    const [paid] = await Promise.all([
      page.waitForResponse((candidate) => matchesOperationResponse(candidate, "pay_subscription_invoice"), { timeout: 45_000 }),
      submitForm(page, "pay-subscription-invoice"),
    ])
    expect(paid.ok()).toBe(true)
    const exactPayments = async () => (await rows(page, "account-payments")).filter((row) => {
      const reconciled = row.reconciledInvoiceIds ?? row.reconciled_invoice_ids
      return scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
        scalarQueryId(row.companyId ?? row.company_id) === companyId &&
        Array.isArray(reconciled) && reconciled.some((id) => scalarQueryId(id) === paidInvoiceId)
    })
    await expect.poll(async () => (await exactPayments()).length, { timeout: 30_000 }).toBe(1)
    const paymentId = scalarQueryId((await exactPayments())[0]!.id)
    if (paymentId == null) throw new Error("Reconciled payment has no exact ID")

    const sheet = await openCanonicalHandoffs(page, source)
    await expect(sheet.getByTestId(`subscription-handoff-invoice-${invoiceIds[0]}`)).toBeVisible()
    await expect(sheet.getByTestId(`subscription-handoff-invoice-${invoiceIds[1]}`)).toBeVisible()
    await expect(sheet.getByTestId(`subscription-handoff-payment-${paymentId}`)).toBeVisible()
    // Exact, unambiguous relations: no unavailable or invariant alert in the handoff panel.
    await expect(sheet.getByTestId("subscription-handoffs").getByRole("alert")).toHaveCount(0)
    await clickCanonicalHandoff(page, source, `subscription-handoff-payment-${paymentId}`, { module: "accounting", tab: "payments", id: paymentId })
  })
})
