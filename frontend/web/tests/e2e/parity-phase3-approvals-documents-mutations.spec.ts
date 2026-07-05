/**
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`).
 *
 * Seeded records: vendor partner `Globex Corp`, product `Lumiere Dev Laptop`.
 */
import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  createApprovalRuleViaUi,
  expectNoAppError,
  fetchLatestPurchaseOrderIdByPartner,
  fetchPurchaseOrderSelectLabel,
  fetchVendorPartnerIdByName,
  fillField,
  gotoModule,
  rejectApprovalRequestViaUi,
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForPendingApprovalRequest,
  waitForPurchaseOrderState,
} from "./helpers"

const VENDOR_NAME = "Globex Corp"

test.describe(
  "Parity phase 3 — approvals and documents mutations",
  { tag: ["@dev-fixture", "@parity-phase-3"] },
  () => {
    test("blocks PO confirm behind approval rule then rejects the pending request", async ({
      page,
    }) => {
      test.setTimeout(240_000)

      const ruleName = smokeName("approval-po")
      const origin = smokeName("approval-po")
      const vendorPartnerId = await fetchVendorPartnerIdByName(page, VENDOR_NAME)

      await createApprovalRuleViaUi(page, { name: ruleName, threshold: "100" })

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

      await page.getByTestId("module-tab-purchasing-orders").click()
      await selectEntityRowById(page, orderId)
      await waitForEntityActionEnabled(page, "entity-action-po-confirm")
      await page.getByTestId("entity-action-po-confirm").click()

      await waitForPurchaseOrderState(page, orderId, "ToApprove")
      const requestId = await waitForPendingApprovalRequest(page, "purchase_order", orderId)
      await rejectApprovalRequestViaUi(page, requestId, "E2E approval reject")

      await expectNoAppError(page)
    })
  },
)
