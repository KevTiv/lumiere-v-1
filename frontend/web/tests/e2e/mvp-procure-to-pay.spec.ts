import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  assertMoveLinesBalanced,
  clickEntityActionAndWaitForReducer,
  expectNoAppError,
  fetchAccountSelectLabelByInternalType,
  fetchDraftVendorBillMoveIdByPartner,
  fetchLatestPurchaseOrderIdByPartner,
  fetchLatestPurchaseOrderLineIdByOrder,
  fetchPurchaseOrderLineReceiveLabel,
  fetchPurchaseOrderSelectLabel,
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

    // Step 1 — create purchase order (UI)
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

    // Step 2 — add purchase order line (UI)
    await page.getByTestId("module-tab-purchasing-lines").click()
    await page.getByTestId("entity-action-pol-add-form").click()
    await expect(page.getByTestId("form-modal-add-purchase-order-line")).toBeVisible()
    await chooseSelectOptionByLabel(page, "orderId", orderLabel)
    await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
    await chooseFirstEnabledOption(page, "uomId")
    await fillField(page, "quantity", "2")
    await fillField(page, "priceUnit", "500")
    const [lineRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/add_purchase_order_line") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "add-purchase-order-line"),
    ])
    expect(lineRes.ok()).toBe(true)

    // Step 3 — confirm purchase order (UI)
    await page.getByTestId("module-tab-purchasing-orders").click()
    await selectEntityRowById(page, orderId)
    await clickEntityActionAndWaitForReducer(page, "entity-action-po-confirm", "confirm_purchase_order")
    await waitForPurchaseOrderState(page, orderId, "Purchase")

    // Receive goods (UI — bill reducer requires qty_received > qty_invoiced)
    const lineId = await fetchLatestPurchaseOrderLineIdByOrder(page, orderId)
    const receiveLabel = await fetchPurchaseOrderLineReceiveLabel(page, orderId, lineId)
    await page.getByTestId("module-tab-purchasing-lines").click()
    await page.getByTestId("entity-action-pol-receive-form").click()
    await expect(page.getByTestId("form-modal-receive-purchase-order-line")).toBeVisible()
    await chooseSelectOptionByLabel(page, "lineId", receiveLabel)
    await fillField(page, "qty", "2")
    const [receiveRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/receive_po_line") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "receive-purchase-order-line"),
    ])
    expect(receiveRes.ok()).toBe(true)

    // Step 4 — create vendor bill from PO (UI)
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

    const moveId = await fetchDraftVendorBillMoveIdByPartner(page, VENDOR_NAME)
    await assertMoveLinesBalanced(page, moveId)

    // Step 5 — post vendor bill (UI — bills tab → detail modal → Post)
    await postDraftBillViaUi(page, VENDOR_NAME)

    await expectNoAppError(page)
  })
})
