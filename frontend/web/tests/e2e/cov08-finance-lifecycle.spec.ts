import { randomUUID } from "node:crypto"
import { expect, test, type Page, type Request } from "@playwright/test"

import { loseNextResponse } from "./pretenant-support"
import {
  chooseFirstEnabledOption,
  chooseSelectOptionByValue,
  fetchDefaultCompanyId,
  fetchInvoiceMoveDetails,
  fetchPaymentIdByExactReference,
  fillField,
  gotoModule,
  isoDate,
  postDraftInvoiceViaUi,
  scalarQueryId,
  selectEntityRowById,
  signIn,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPaymentPosted,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

function tag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return ""
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function moveSnapshot(page: Page, moveId: number) {
  const row = (await rows(page, "account-moves")).find((candidate) => scalarQueryId(candidate.id) === moveId)
  if (!row) throw new Error(`move not found: ${moveId}`)
  return {
    id: moveId,
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: tag(row.state),
    paymentState: tag(row.paymentState ?? row.payment_state),
    total: Number(row.amountTotal ?? row.amount_total),
    residual: Number(row.amountResidual ?? row.amount_residual),
  }
}

async function paymentSnapshot(page: Page, paymentId: number) {
  const row = (await rows(page, "account-payments")).find((candidate) => scalarQueryId(candidate.id) === paymentId)
  if (!row) throw new Error(`payment not found: ${paymentId}`)
  return {
    id: paymentId,
    state: tag(row.state),
    amount: Number(row.amount),
    ref: String(row.ref ?? ""),
  }
}

async function openCreateInvoice(page: Page, requestUuid: string, description: string) {
  await gotoModule(page, "/accounting", "accounting")
  await page.evaluate((value) => {
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: () => value })
  }, requestUuid)
  await page.getByTestId("quick-action-create_invoice").click()
  await expect(page.getByTestId("create-invoice-modal")).toBeVisible()
  await page.getByTestId("create-invoice-partner").click()
  await page.getByRole("option").first().click()
  await page.getByTestId("create-invoice-line-description").fill(description)
  await page.getByTestId("create-invoice-line-unit-price").fill("90")
  await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()
}

async function manualInvoiceMoves(page: Page, companyId: number, key: string) {
  const response = await page.request.get(`/api/accounting/manual-invoice-results/${companyId}/${key}`)
  if (!response.ok()) return null
  const body = (await response.json()) as { data?: { id?: string } }
  return scalarQueryId(body.data?.id)
}

test.describe("COV-08 invoice to payment to reconciliation", { tag: ["@p0", "@cov08"] }, () => {
  test("a lost invoice-create response is recovered by the operator without a duplicate", async ({ page }) => {
    test.setTimeout(180_000)
    const companyId = await fetchDefaultCompanyId(page)
    const description = smokeName("cov08-lost-invoice")
    const requestUuid = randomUUID()
    const key = requestUuid.replaceAll("-", "")

    await openCreateInvoice(page, requestUuid, description)
    const drop = await loseNextResponse(page, "create_manual_account_invoice")
    await page.getByTestId("create-invoice-save-draft").click()
    await expect.poll(() => drop.lost()).toBe(true)
    // The server committed; the browser never saw the reply.
    await expect.poll(() => manualInvoiceMoves(page, companyId, key), { timeout: 30_000 }).not.toBeNull()
    const committed = await manualInvoiceMoves(page, companyId, key)
    await page.unroute(() => true).catch(() => undefined)

    // Operator retries the same form (same request key): exactly one move results.
    await openCreateInvoice(page, requestUuid, description)
    let dispatches = 0
    const count = (request: Request) => {
      if (matchesOperationResponse(request, "create_manual_account_invoice")) dispatches += 1
    }
    page.on("request", count)
    try {
      await page.getByTestId("create-invoice-save-draft").click()
      await expect(page.getByTestId("create-invoice-modal")).toBeHidden({ timeout: 30_000 })
    } finally {
      page.off("request", count)
    }
    expect(dispatches).toBe(0)
    expect(await manualInvoiceMoves(page, companyId, key)).toBe(committed)
    const lines = (await rows(page, "account-move-lines")).filter(
      (row) => scalarQueryId(row.moveId ?? row.move_id) === committed,
    )
    expect(lines).toHaveLength(2)
  })

  test("create, post, pay and register through the UI with exact identities and safe replay", async ({ browser, page }) => {
    test.setTimeout(300_000)
    const companyId = await fetchDefaultCompanyId(page)
    const description = smokeName("cov08-invoice")
    const requestUuid = randomUUID()
    const key = requestUuid.replaceAll("-", "")

    await openCreateInvoice(page, requestUuid, description)
    await page.getByTestId("create-invoice-save-draft").click()
    await expect(page.getByTestId("create-invoice-modal")).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => manualInvoiceMoves(page, companyId, key), { timeout: 30_000 }).not.toBeNull()
    const invoiceId = (await manualInvoiceMoves(page, companyId, key))!
    expect(await moveSnapshot(page, invoiceId)).toMatchObject({ companyId, state: "Draft", total: 90 })

    await postDraftInvoiceViaUi(page, invoiceId)
    expect(await moveSnapshot(page, invoiceId)).toMatchObject({ state: "Posted", total: 90, residual: 90 })

    const { partnerId, amountTotal, currencyId } = await fetchInvoiceMoveDetails(page, invoiceId)
    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-payments").click()
    await page.getByTestId("module-create-accounting-payments").click()
    await expect(page.getByTestId("form-modal-new-account-payment")).toBeVisible()
    await chooseSelectOptionByValue(page, "partnerId", partnerId)
    await fillField(page, "amount", String(amountTotal))
    await chooseSelectOptionByValue(page, "currencyId", currencyId)
    await chooseFirstEnabledOption(page, "journalId")
    await fillField(page, "date", isoDate(0))
    const paymentRef = smokeName("cov08-payment")
    await fillField(page, "ref", paymentRef)
    const [created] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "create_payment") && res.ok(), { timeout: 30_000 }),
      submitForm(page, "new-account-payment"),
    ])
    expect(created.ok()).toBe(true)
    const paymentId = await fetchPaymentIdByExactReference(page, partnerId, paymentRef, { state: "NotPaid" })
    expect((await rows(page, "account-payments")).filter((row) => String(row.ref ?? "") === paymentRef)).toHaveLength(1)

    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-post")
    const [posted] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "post_payment") && res.ok(), { timeout: 30_000 }),
      page.getByTestId("entity-action-pay-post").click(),
    ])
    expect(posted.ok()).toBe(true)
    await waitForPaymentPosted(page, paymentId)
    expect(await paymentSnapshot(page, paymentId)).toMatchObject({ amount: 90, ref: paymentRef })

    // Posting twice is a no-op error and changes nothing.
    const postedEffect = await paymentSnapshot(page, paymentId)
    expect((await replay(page, posted.request())).ok()).toBe(false)
    expect(await paymentSnapshot(page, paymentId)).toEqual(postedEffect)

    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-link")
    await page.getByTestId("entity-action-pay-link").click()
    await expect(page.getByTestId("form-modal-register-payment-invoices")).toBeVisible()
    await chooseSelectOptionByValue(page, "invoiceIds", invoiceId)
    const [registered] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "register_payment_on_invoice") && res.ok(), { timeout: 30_000 }),
      submitForm(page, "register-payment-invoices"),
    ])
    expect(registered.ok()).toBe(true)
    await expect
      .poll(() => moveSnapshot(page, invoiceId), { timeout: 30_000 })
      .toMatchObject({ state: "Posted", paymentState: "Paid", residual: 0 })
    const settled = await moveSnapshot(page, invoiceId)

    const stale = await replay(page, registered.request())
    expect(stale.ok()).toBe(false)
    expect(await moveSnapshot(page, invoiceId)).toEqual(settled)
    expect(await paymentSnapshot(page, paymentId)).toEqual(postedEffect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, registered.request())
      expect(denied.status()).toBe(403)
      expect(await moveSnapshot(page, invoiceId)).toEqual(settled)
    } finally {
      await readerContext.close()
    }
  })

  test("reversing a posted payment yields one exact reversal and refuses a second", async ({ page }) => {
    test.setTimeout(240_000)
    const companyId = await fetchDefaultCompanyId(page)
    const description = smokeName("cov08-rev-invoice")
    const requestUuid = randomUUID()
    const key = requestUuid.replaceAll("-", "")
    await openCreateInvoice(page, requestUuid, description)
    await page.getByTestId("create-invoice-save-draft").click()
    await expect(page.getByTestId("create-invoice-modal")).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => manualInvoiceMoves(page, companyId, key), { timeout: 30_000 }).not.toBeNull()
    const invoiceId = (await manualInvoiceMoves(page, companyId, key))!
    const { partnerId, amountTotal, currencyId } = await fetchInvoiceMoveDetails(page, invoiceId)

    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-payments").click()
    await page.getByTestId("module-create-accounting-payments").click()
    await chooseSelectOptionByValue(page, "partnerId", partnerId)
    await fillField(page, "amount", String(amountTotal))
    await chooseSelectOptionByValue(page, "currencyId", currencyId)
    await chooseFirstEnabledOption(page, "journalId")
    await fillField(page, "date", isoDate(0))
    const paymentRef = smokeName("cov08-reversal")
    await fillField(page, "ref", paymentRef)
    await submitForm(page, "new-account-payment")
    const paymentId = await fetchPaymentIdByExactReference(page, partnerId, paymentRef, { state: "NotPaid" })
    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-post")
    await page.getByTestId("entity-action-pay-post").click()
    await waitForPaymentPosted(page, paymentId)

    const movesBefore = (await rows(page, "account-moves")).length
    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-cancel")
    const [cancelled] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "cancel_payment"), { timeout: 30_000 }),
      page.getByTestId("entity-action-pay-cancel").click(),
    ])
    expect(cancelled.ok(), await cancelled.text()).toBe(true)
    await expect.poll(() => paymentSnapshot(page, paymentId), { timeout: 30_000 }).toMatchObject({
      id: paymentId,
      state: "Reversed",
      ref: paymentRef,
    })
    const reversed = await paymentSnapshot(page, paymentId)
    // The reversal posts exactly one balancing move, and the payment record is unchanged otherwise.
    expect((await rows(page, "account-moves")).length).toBe(movesBefore + 1)

    const second = await replay(page, cancelled.request())
    expect(second.ok()).toBe(false)
    expect(await second.text()).toMatch(/already cancelled/i)
    expect(await paymentSnapshot(page, paymentId)).toEqual(reversed)
    expect((await rows(page, "account-moves")).length).toBe(movesBefore + 1)
  })
})
