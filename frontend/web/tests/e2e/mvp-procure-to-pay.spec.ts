import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  chooseSelectOptionByValue,
  assertMoveLinesBalanced,
  clickEntityActionAndWaitForReducer,
  callReducerBff,
  expectNoAppError,
  expectPostDraftBillRejected,
  fetchAccountSelectLabelByInternalType,
  fetchDraftVendorBillMoveIdByPartner,
  fetchInvoiceMoveDetails,
  fetchLatestPaymentIdByPartner,
  fetchLatestPurchaseOrderIdByPartner,
  fetchLatestPurchaseOrderLineIdByOrder,
  fetchPurchaseOrderLineReceiveLabel,
  fetchPurchaseOrderSelectLabel,
  fetchSessionOrganizationId,
  fetchVendorBillJournalLabel,
  fetchVendorPartnerIdByName,
  fillField,
  gotoModule,
  postDraftBillViaUi,
  scalarQueryString,
  selectEntityRowById,
  selectModuleTab,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPurchaseOrderState,
  waitForPoLineMatchStatus,
  waitForPaymentPosted,
} from "./helpers"

const VENDOR_NAME = "Globex Corp"
type AccountMoveQueryRow = QueryRowFor<"account-moves">

async function waitForSettledBill(
  page: import("@playwright/test").Page,
  moveId: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/query/account-moves")
        if (!response.ok()) return false
        const payload = (await response.json()) as { data?: AccountMoveQueryRow[] }
        const move = (payload.data ?? []).find((row) => Number(row.id) === moveId)
        return (
          move != null &&
          Number(move.amountResidual) === 0 &&
          scalarQueryString(move.paymentState) === "Paid"
        )
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

async function createConfirmedPoWithLine(
  page: import("@playwright/test").Page,
  origin: string,
  vendorPartnerId: number,
  quantity: string,
) {
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", "orders")
  await page.getByTestId("module-create-purchasing-orders").click()
  await expect(page.getByTestId("form-modal-new-purchase-order")).toBeVisible()
  await chooseSelectOptionByLabel(page, "partnerId", VENDOR_NAME)
  await chooseFirstEnabledOption(page, "pricelistId")
  await fillField(page, "origin", origin)
  const [createPoRes] = await Promise.all([
    page.waitForResponse(
      (res) => matchesOperationResponse(res, "create_purchase_order") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "new-purchase-order"),
  ])
  expect(createPoRes.ok()).toBe(true)

  const orderId = await fetchLatestPurchaseOrderIdByPartner(page, vendorPartnerId, origin)
  const orderLabel = await fetchPurchaseOrderSelectLabel(page, orderId)

  await selectModuleTab(page, "purchasing", "lines")
  await page.getByTestId("entity-action-pol-add-form").click()
  await expect(page.getByTestId("form-modal-add-purchase-order-line")).toBeVisible()
  await chooseSelectOptionByLabel(page, "orderId", orderLabel)
  await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "quantity", quantity)
  await fillField(page, "priceUnit", "500")
  const [lineRes] = await Promise.all([
    page.waitForResponse(
      (res) => matchesOperationResponse(res, "add_purchase_order_line") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "add-purchase-order-line"),
  ])
  expect(lineRes.ok()).toBe(true)

  await selectModuleTab(page, "purchasing", "orders")
  await selectEntityRowById(page, orderId)
  await clickEntityActionAndWaitForReducer(page, "entity-action-po-confirm", "confirm_purchase_order")
  await waitForPurchaseOrderState(page, orderId, "Purchase")

  return { orderId, orderLabel }
}

async function receivePoLineQty(
  page: import("@playwright/test").Page,
  orderId: number,
  lineId: number,
  qty: string,
) {
  const receiveLabel = await fetchPurchaseOrderLineReceiveLabel(page, orderId, lineId)
  await selectModuleTab(page, "purchasing", "lines")
  await page.getByTestId("entity-action-pol-receive-form").click()
  await expect(page.getByTestId("form-modal-receive-purchase-order-line")).toBeVisible()
  await chooseSelectOptionByLabel(page, "lineId", receiveLabel)
  await fillField(page, "qty", qty)
  const [receiveRes] = await Promise.all([
    page.waitForResponse(
      (res) => matchesOperationResponse(res, "receive_po_line") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "receive-purchase-order-line"),
  ])
  expect(receiveRes.ok()).toBe(true)
}

async function createBillFromPo(page: import("@playwright/test").Page, orderId: number) {
  await selectModuleTab(page, "purchasing", "orders")
  const journalLabel = await fetchVendorBillJournalLabel(page)
  const expenseLabel = await fetchAccountSelectLabelByInternalType(page, "expense")
  const payableLabel = await fetchAccountSelectLabelByInternalType(page, "payable")
  await selectEntityRowById(page, orderId)
  await waitForEntityActionEnabled(page, "entity-action-po-create-bill")
  await page.getByTestId("entity-action-po-create-bill").click()
  await expect(page.getByTestId("form-modal-create-bill-from-purchase-order")).toBeVisible({
    timeout: 15_000,
  })
  await chooseSelectOptionByLabel(page, "journalId", journalLabel)
  await chooseSelectOptionByLabel(page, "defaultExpenseAccountId", expenseLabel)
  await chooseSelectOptionByLabel(page, "payableAccountId", payableLabel)
  await fillField(page, "invoiceDate", new Date().toISOString().slice(0, 10))
  const [billRes] = await Promise.all([
    page.waitForResponse(
      (res) =>
        matchesOperationResponse(res, "create_bill_from_purchase_order") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "create-bill-from-purchase-order"),
  ])
  expect(billRes.ok()).toBe(true)
  return billRes
}

/**
 * Procure-to-pay golden path (see docs/MVP_WORKFLOW_CONTRACT.md secondary path).
 *
 * UI: create PO → add line → confirm → receive goods → bill from PO modal → post bill.
 */
test.describe("MVP procure-to-pay workflow", { tag: "@p0" }, () => {
  test("creates purchase order through vendor bill post", async ({ page }) => {
    test.setTimeout(240_000)

    const origin = smokeName("mvp-po")
    const vendorPartnerId = await fetchVendorPartnerIdByName(page, VENDOR_NAME)

    const { orderId } = await createConfirmedPoWithLine(page, origin, vendorPartnerId, "2")

    const lineId = await fetchLatestPurchaseOrderLineIdByOrder(page, orderId)
    await receivePoLineQty(page, orderId, lineId, "2")

    const billResponse = await createBillFromPo(page, orderId)

    const moveId = await fetchDraftVendorBillMoveIdByPartner(page, VENDOR_NAME)
    await assertMoveLinesBalanced(page, moveId)

    // Replaying the exact command must fail without creating another bill.
    const duplicateBillResponse = await page.request.fetch(billResponse.request())
    expect(duplicateBillResponse.ok()).toBe(false)
    expect(await fetchDraftVendorBillMoveIdByPartner(page, VENDOR_NAME)).toBe(moveId)

    await postDraftBillViaUi(page, VENDOR_NAME)

    const { amountTotal, currencyId } = await fetchInvoiceMoveDetails(page, moveId)
    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-payments").click()
    await page.getByTestId("module-create-accounting-payments").click()
    await expect(page.getByTestId("form-modal-new-account-payment")).toBeVisible()
    await chooseSelectOptionByValue(page, "paymentType", "OutBound")
    await chooseSelectOptionByValue(page, "partnerType", "Supplier")
    await chooseSelectOptionByLabel(page, "partnerId", VENDOR_NAME)
    await fillField(page, "amount", String(amountTotal))
    await chooseSelectOptionByValue(page, "currencyId", currencyId)
    await chooseFirstEnabledOption(page, "journalId")
    await fillField(page, "date", new Date().toISOString().slice(0, 10))
    const [createPaymentResponse] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_payment") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-account-payment"),
    ])
    expect(createPaymentResponse.ok()).toBe(true)

    const paymentId = await fetchLatestPaymentIdByPartner(page, vendorPartnerId, {
      state: "NotPaid",
    })
    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-post")
    const [postPaymentResponse] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "post_payment") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-pay-post").click(),
    ])
    expect(postPaymentResponse.ok()).toBe(true)
    await waitForPaymentPosted(page, paymentId)

    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-link")
    await page.getByTestId("entity-action-pay-link").click()
    await expect(page.getByTestId("form-modal-register-payment-invoices")).toBeVisible()
    await chooseSelectOptionByValue(page, "invoiceIds", moveId)
    await page.getByTestId("form-field-isBill").click()
    const [registerPaymentResponse] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "register_payment_on_invoice") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "register-payment-invoices"),
    ])
    expect(registerPaymentResponse.ok()).toBe(true)

    await page.reload({ waitUntil: "domcontentloaded" })
    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-payments").click()
    await expect(page.getByTestId(`entity-row-${paymentId}`)).toContainText(VENDOR_NAME)
    await waitForSettledBill(page, moveId)
    expect(await fetchLatestPaymentIdByPartner(page, vendorPartnerId, { state: "Paid" })).toBe(
      paymentId,
    )

    await expectNoAppError(page)
  })

  test("partial receive bills and posts with matched status", async ({ page }) => {
    test.setTimeout(240_000)

    const origin = smokeName("mvp-po-partial")
    const vendorPartnerId = await fetchVendorPartnerIdByName(page, VENDOR_NAME)

    const { orderId } = await createConfirmedPoWithLine(page, origin, vendorPartnerId, "10")

    const lineId = await fetchLatestPurchaseOrderLineIdByOrder(page, orderId)
    await receivePoLineQty(page, orderId, lineId, "5")

    await createBillFromPo(page, orderId)

    const moveId = await fetchDraftVendorBillMoveIdByPartner(page, VENDOR_NAME)
    await assertMoveLinesBalanced(page, moveId)

    await waitForPoLineMatchStatus(page, lineId, "matched")

    await page.reload()
    await gotoModule(page, "/purchasing", "purchasing")
    await selectModuleTab(page, "purchasing", "lines")
    await expect(page.getByTestId(`entity-row-${lineId}`)).toContainText("Matched", {
      timeout: 30_000,
    })

    await postDraftBillViaUi(page, VENDOR_NAME)

    await expectNoAppError(page)
  })

  test("blocks bill post when billed qty exceeds received", async ({ page }) => {
    test.setTimeout(240_000)

    const origin = smokeName("mvp-po-overbill")
    const vendorPartnerId = await fetchVendorPartnerIdByName(page, VENDOR_NAME)

    const { orderId } = await createConfirmedPoWithLine(page, origin, vendorPartnerId, "10")

    const lineId = await fetchLatestPurchaseOrderLineIdByOrder(page, orderId)
    await receivePoLineQty(page, orderId, lineId, "5")

    await createBillFromPo(page, orderId)

    const orgId = await fetchSessionOrganizationId(page)
    await callReducerBff(page, "invoice_po_line", [orgId, lineId, 5])

    await waitForPoLineMatchStatus(page, lineId, "over_billed")

    await page.reload()
    await gotoModule(page, "/purchasing", "purchasing")
    await selectModuleTab(page, "purchasing", "lines")
    await expect(page.getByTestId(`entity-row-${lineId}`)).toContainText("Over-billed", {
      timeout: 30_000,
    })

    await expectPostDraftBillRejected(page, VENDOR_NAME, /three-way match failed/i)
  })
})
