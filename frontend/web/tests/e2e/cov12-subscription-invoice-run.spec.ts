import { expect, test, type Page, type Request } from "@playwright/test"

import {
  chooseSelectOptionByLabel,
  fetchAccountSelectLabelByInternalType,
  fetchSalesInvoiceJournalLabel,
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

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

function tagged(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return ""
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function accountLabelByCode(page: Page, code: string) {
  const row = (await rows(page, "account-accounts")).find(
    (candidate) => String(candidate.code ?? "") === code,
  )
  if (!row) throw new Error(`account not found: ${code}`)
  const name = String(row.name ?? "")
  return name ? `${code} — ${name}` : code
}

async function journalLabelByCode(page: Page, code: string) {
  const row = (await rows(page, "account-journals")).find(
    (candidate) => String(candidate.code ?? "").toUpperCase() === code,
  )
  if (!row) throw new Error(`journal not found: ${code}`)
  const name = String(row.name ?? "")
  return name ? `${code} — ${name}` : code
}

async function billingRunSnapshot(page: Page, billingRunKey: string) {
  const matches = (await rows(page, "subscription-billing-runs")).filter(
    (row) =>
      String(row.billingRunKey ?? row.billing_run_key ?? "") === billingRunKey,
  )
  if (matches.length !== 1) {
    throw new Error(
      `expected one billing run for ${billingRunKey}, found ${matches.length}`,
    )
  }
  const row = matches[0]!
  return {
    id: scalarQueryId(row.id),
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    subscriptionId: scalarQueryId(
      row.subscriptionId ?? row.subscription_id,
    ),
    billingRunKey: String(
      row.billingRunKey ?? row.billing_run_key ?? "",
    ),
    invoiceMoveId: scalarQueryId(
      row.invoiceMoveId ?? row.invoice_move_id,
    ),
  }
}

async function invoiceSnapshot(page: Page, moveId: number) {
  const row = (await rows(page, "account-moves")).find(
    (candidate) => scalarQueryId(candidate.id) === moveId,
  )
  if (!row) throw new Error(`invoice move not found: ${moveId}`)
  return {
    id: moveId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    moveType: tagged(row.moveType ?? row.move_type),
    state: tagged(row.state),
    paymentState: tagged(row.paymentState ?? row.payment_state),
    amountTotal: Number(row.amountTotal ?? row.amount_total ?? 0),
    amountResidual: Number(row.amountResidual ?? row.amount_residual ?? 0),
    ref: String(row.ref ?? row.name ?? ""),
  }
}

function moveOptionLabel(snapshot: Awaited<ReturnType<typeof invoiceSnapshot>>) {
  return snapshot.ref
    ? `${snapshot.ref} (${snapshot.moveType})`
    : `Move #${snapshot.id} (${snapshot.moveType})`
}

test.describe(
  "COV-12 recurring subscription invoice run",
  { tag: ["@p0", "@cov12"] },
  () => {
    test("generates one exact billing run, reuses it on retry, pays its invoice, and denies reader replay", async ({
      browser,
      page,
    }) => {
      test.setTimeout(300_000)
      await gotoModule(page, "/subscriptions", "subscriptions")

      const subscription = (await rows(page, "subscriptions")).find(
        (row) => String(row.code ?? "") === "SUB-ACME-001",
      )
      const subscriptionId = scalarQueryId(subscription?.id)
      const companyId = scalarQueryId(
        subscription?.companyId ?? subscription?.company_id,
      )
      const organizationId = scalarQueryId(
        subscription?.organizationId ?? subscription?.organization_id,
      )
      if (subscriptionId == null || companyId == null || organizationId == null) {
        throw new Error("seeded SUB-ACME-001 is unavailable")
      }

      const billingRunKey = smokeName("cov12-run")
      const incomeLabel =
        await fetchAccountSelectLabelByInternalType(page, "income")
      const receivableLabel =
        await fetchAccountSelectLabelByInternalType(page, "receivable")
      const invoiceJournalLabel = await fetchSalesInvoiceJournalLabel(page)

      await selectModuleTab(page, "subscriptions", "subscriptions")
      await selectEntityRowById(page, subscriptionId)
      const generateAction = page.getByTestId("entity-action-gen-inv")
      await expect(generateAction).toBeEnabled()
      await generateAction.click()
      await expect(
        page.getByTestId("form-modal-generate-subscription-invoice"),
      ).toBeVisible({ timeout: 15_000 })

      await fillField(page, "invoiceDate", isoDate(0))
      await fillField(page, "billingRunKey", billingRunKey)
      await chooseSelectOptionByLabel(
        page,
        "journalId",
        invoiceJournalLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "incomeAccountId",
        incomeLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "receivableAccountId",
        receivableLabel,
      )

      const [generated] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(
              response,
              "generate_subscription_invoice",
            ),
          { timeout: 45_000 },
        ),
        submitForm(page, "generate-subscription-invoice"),
      ])
      expect(generated.ok()).toBe(true)

      await expect
        .poll(async () => {
          const run = await billingRunSnapshot(page, billingRunKey)
          return run.invoiceMoveId
        })
        .not.toBeNull()
      const runEffect = await billingRunSnapshot(page, billingRunKey)
      expect(runEffect).toMatchObject({
        organizationId,
        companyId,
        subscriptionId,
        billingRunKey,
      })
      const invoiceMoveId = runEffect.invoiceMoveId
      if (invoiceMoveId == null) {
        throw new Error("billing run has no invoice_move_id")
      }
      const generatedInvoice = await invoiceSnapshot(page, invoiceMoveId)
      expect(generatedInvoice).toMatchObject({
        organizationId,
        companyId,
        moveType: "OutInvoice",
      })

      // Generation is deliberately idempotent by billing_run_key.
      const generateRetry = await replay(page, generated.request())
      expect(generateRetry.ok()).toBe(true)
      expect(await billingRunSnapshot(page, billingRunKey)).toEqual(runEffect)
      expect(
        await invoiceSnapshot(page, invoiceMoveId),
      ).toEqual(generatedInvoice)

      await gotoModule(page, "/subscriptions", "subscriptions")
      await selectModuleTab(page, "subscriptions", "subscriptions")
      await selectEntityRowById(page, subscriptionId)
      const payAction = page.getByTestId("entity-action-pay-inv")
      await expect(payAction).toBeEnabled()
      await payAction.click()
      await expect(
        page.getByTestId("form-modal-pay-subscription-invoice"),
      ).toBeVisible({ timeout: 15_000 })

      await chooseSelectOptionByLabel(
        page,
        "invoiceMoveId",
        moveOptionLabel(generatedInvoice),
      )
      await chooseSelectOptionByLabel(
        page,
        "paymentJournalId",
        await journalLabelByCode(page, "BNK"),
      )
      await chooseSelectOptionByLabel(
        page,
        "bankAccountId",
        await accountLabelByCode(page, "1200"),
      )
      await chooseSelectOptionByLabel(
        page,
        "receivableAccountId",
        receivableLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "cogsAccountId",
        await accountLabelByCode(page, "5000"),
      )
      await chooseSelectOptionByLabel(
        page,
        "inventoryAccountId",
        await accountLabelByCode(page, "1400"),
      )

      const [paid] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "pay_subscription_invoice"),
          { timeout: 45_000 },
        ),
        submitForm(page, "pay-subscription-invoice"),
      ])
      expect(paid.ok()).toBe(true)

      await expect
        .poll(async () => {
          const invoice = await invoiceSnapshot(page, invoiceMoveId)
          return {
            state: invoice.state,
            paymentState: invoice.paymentState,
            residual: invoice.amountResidual,
          }
        })
        .toEqual({
          state: "Posted",
          paymentState: "Paid",
          residual: 0,
        })

      const paidEffect = await invoiceSnapshot(page, invoiceMoveId)
      const stalePayment = await replay(page, paid.request())
      expect(stalePayment.status()).toBe(422)
      expect(await invoiceSnapshot(page, invoiceMoveId)).toEqual(
        paidEffect,
      )
      expect(await billingRunSnapshot(page, billingRunKey)).toEqual(runEffect)

      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        for (const request of [generated.request(), paid.request()]) {
          const denied = await replay(readerPage, request)
          expect(denied.status()).toBe(403)
        }
        expect(await billingRunSnapshot(page, billingRunKey)).toEqual(runEffect)
        expect(await invoiceSnapshot(page, invoiceMoveId)).toEqual(
          paidEffect,
        )
      } finally {
        await readerContext.close()
      }
    })
  },
)
