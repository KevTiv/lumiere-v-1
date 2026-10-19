import { randomUUID } from "node:crypto"

import { expect, test, type Page, type Response } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  chooseSelectOptionByValue,
  fetchDefaultCompanyId,
  fetchInvoiceMoveDetails,
  fetchPaymentIdByExactReference,
  fillField,
  gotoModule,
  openAccountingTab,
  postDraftInvoiceViaUi,
  scalarQueryId,
  scalarQueryString,
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPaymentPosted,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { loseNextResponse } from "./pretenant-support"

/** Operator-driven COV-08 steps shared by the invoice, payment and reconcile specs (no compatibility route). */
export type Row = Record<string, unknown>

export async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

export async function moveSnapshot(page: Page, moveId: number) {
  const move = (await rows(page, "account-moves")).find((row) => scalarQueryId(row.id) === moveId)
  if (!move) throw new Error(`account move ${moveId} not found`)
  return {
    residual: Number(move.amountResidual ?? move.amount_residual),
    paymentState: scalarQueryString(move.paymentState ?? move.payment_state),
    state: scalarQueryString(move.state),
  }
}

/** Operator creates a draft customer invoice and posts it; returns its canonical move id. */
export async function createAndPostInvoice(page: Page, label: string): Promise<number> {
  const companyId = await fetchDefaultCompanyId(page)
  const requestUuid = randomUUID()
  const requestKey = requestUuid.replaceAll("-", "")
  await gotoModule(page, "/accounting", "accounting")
  await page.evaluate((value) => {
    Object.defineProperty(window.crypto, "randomUUID", { configurable: true, value: () => value })
  }, requestUuid)
  await page.getByTestId("quick-action-create_invoice").click()
  await expect(page.getByTestId("create-invoice-modal")).toBeVisible()
  await page.getByTestId("create-invoice-partner").click()
  await page.getByRole("option").first().click()
  await page.getByTestId("create-invoice-line-description").fill(smokeName(label))
  await page.getByTestId("create-invoice-line-unit-price").fill("90")
  await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()
  const [dispatch] = await Promise.all([
    page.waitForResponse((r) => matchesOperationResponse(r, "create_manual_account_invoice") && r.ok(), {
      timeout: 30_000,
    }),
    page.getByTestId("create-invoice-save-draft").click(),
  ])
  expect(dispatch.ok()).toBe(true)
  await expect(page.getByTestId("create-invoice-modal")).toBeHidden({ timeout: 30_000 })

  const result = await page.request.get(`/api/accounting/manual-invoice-results/${companyId}/${requestKey}`)
  expect(result.ok()).toBe(true)
  const moveId = scalarQueryId(((await result.json()) as { data?: { id?: string } }).data?.id)
  if (moveId == null) throw new Error("manual invoice result has no move id")
  await postDraftInvoiceViaUi(page, moveId)
  return moveId
}

/** Operator creates and posts an exact-reference customer receipt for the invoice amount. */
export async function createAndPostPayment(page: Page, moveId: number) {
  const { partnerId, amountTotal, currencyId } = await fetchInvoiceMoveDetails(page, moveId)
  const partner = (await rows(page, "contacts")).find((row) => scalarQueryId(row.id) === partnerId)
  const partnerName = String(partner?.name ?? partner?.displayName ?? partner?.display_name ?? "")
  expect(partnerName).not.toBe("")

  await gotoModule(page, "/accounting", "accounting")
  await openAccountingTab(page, "payments")
  await page.getByTestId("module-create-accounting-payments").click()
  await expect(page.getByTestId("form-modal-new-account-payment")).toBeVisible()
  await chooseSelectOptionByValue(page, "paymentType", "InBound")
  await chooseSelectOptionByValue(page, "partnerType", "Customer")
  await chooseSelectOptionByLabel(page, "partnerId", partnerName)
  await fillField(page, "amount", String(amountTotal))
  await chooseSelectOptionByValue(page, "currencyId", currencyId)
  await chooseFirstEnabledOption(page, "journalId")
  await fillField(page, "date", new Date().toISOString().slice(0, 10))
  const reference = smokeName("cov08-pay")
  await fillField(page, "ref", reference)
  const [createResponse] = await Promise.all([
    page.waitForResponse((r) => matchesOperationResponse(r, "create_payment") && r.ok(), { timeout: 30_000 }),
    submitForm(page, "new-account-payment"),
  ])
  const paymentId = await fetchPaymentIdByExactReference(page, partnerId, reference, { state: "NotPaid" })
  await selectEntityRowById(page, paymentId)
  await waitForEntityActionEnabled(page, "entity-action-pay-post")
  await Promise.all([
    page.waitForResponse((r) => matchesOperationResponse(r, "post_payment") && r.ok(), { timeout: 30_000 }),
    page.getByTestId("entity-action-pay-post").click(),
  ])
  await waitForPaymentPosted(page, paymentId)
  return { partnerId, paymentId, reference, createResponse, amountTotal }
}

export async function openRegisterForm(page: Page, paymentId: number, moveId: number) {
  await selectEntityRowById(page, paymentId)
  await waitForEntityActionEnabled(page, "entity-action-pay-link")
  await page.getByTestId("entity-action-pay-link").click()
  await expect(page.getByTestId("form-modal-register-payment-invoices")).toBeVisible()
  await chooseSelectOptionByValue(page, "invoiceIds", moveId)
}

export async function replay(page: Page, response: Response) {
  return page.request.post(new URL(response.url()).pathname, {
    headers: { "Content-Type": "application/json" },
    data: response.request().postDataJSON(),
  })
}
