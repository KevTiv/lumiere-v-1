import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  assertMoveLinesBalanced,
  clickEntityActionAndWaitForReducer,
  callReducerBff,
  expectNoAppError,
  expectPostDraftBillRejected,
  fetchAccountSelectLabelByInternalType,
  fetchDraftVendorBillMoveIdByPartner,
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
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPurchaseOrderState,
} from "./helpers"

const VENDOR_NAME = "Globex Corp"

async function createConfirmedPoWithLine(
  page: import("@playwright/test").Page,
  origin: string,
  vendorPartnerId: number,
  quantity: string,
) {
  await gotoModule(page, "/purchasing", "purchasing")
  await page.getByTestId("module-tab-purchasing-orders").click()
  await page.getByTestId("module-create-purchasing-orders").click()
  await expect(page.getByTestId("form-modal-new-purchase-order")).toBeVisible()
  await chooseSelectOptionByLabel(page, "partnerId", VENDOR_NAME)
  await chooseFirstEnabledOption(page, "pricelistId")
  await fillField(page, "origin", origin)
  const [createPoRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/call/create_purchase_order") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "new-purchase-order"),
  ])
  expect(createPoRes.ok()).toBe(true)

  const orderId = await fetchLatestPurchaseOrderIdByPartner(page, vendorPartnerId)
  const orderLabel = await fetchPurchaseOrderSelectLabel(page, orderId)

  await page.getByTestId("module-tab-purchasing-lines").click()
  await page.getByTestId("entity-action-pol-add-form").click()
  await expect(page.getByTestId("form-modal-add-purchase-order-line")).toBeVisible()
  await chooseSelectOptionByLabel(page, "orderId", orderLabel)
  await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "quantity", quantity)
  await fillField(page, "priceUnit", "500")
  const [lineRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/call/add_purchase_order_line") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "add-purchase-order-line"),
  ])
  expect(lineRes.ok()).toBe(true)

  await page.getByTestId("module-tab-purchasing-orders").click()
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
  await page.getByTestId("module-tab-purchasing-lines").click()
  await page.getByTestId("entity-action-pol-receive-form").click()
  await expect(page.getByTestId("form-modal-receive-purchase-order-line")).toBeVisible()
  await chooseSelectOptionByLabel(page, "lineId", receiveLabel)
  await fillField(page, "qty", qty)
  const [receiveRes] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/call/receive_po_line") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "receive-purchase-order-line"),
  ])
  expect(receiveRes.ok()).toBe(true)
}

async function createBillFromPo(page: import("@playwright/test").Page, orderId: number) {
  await page.getByTestId("module-tab-purchasing-orders").click()
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
  const [billRes] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes("/api/call/create_bill_from_purchase_order") && res.ok(),
      { timeout: 30_000 },
    ),
    submitForm(page, "create-bill-from-purchase-order"),
  ])
  expect(billRes.ok()).toBe(true)
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

    await createBillFromPo(page, orderId)

    const moveId = await fetchDraftVendorBillMoveIdByPartner(page, VENDOR_NAME)
    await assertMoveLinesBalanced(page, moveId)

    await postDraftBillViaUi(page, VENDOR_NAME)

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

    await page.getByTestId("module-tab-purchasing-lines").click()
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

    await page.getByTestId("module-tab-purchasing-lines").click()
    await expect(page.getByTestId(`entity-row-${lineId}`)).toContainText("Over-billed", {
      timeout: 30_000,
    })

    await expectPostDraftBillRejected(page, VENDOR_NAME, /three-way match failed/i)
  })
})
