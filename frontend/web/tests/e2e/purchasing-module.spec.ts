/**
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`) for the
 * seeded PO visibility test. Other tests create their own data or only open modals.
 *
 * Seeded records: purchase order `PO/2024/0001`.
 */
import { expect, test, type Page } from "@playwright/test"

/** @dev-fixture — excluded from E2E_SUITE=p0; requires seed_dev_data fixture rows. */

import { expectNoAppError, expectSeededText, gotoModule, openEntityCreate } from "./helpers"

const PURCHASING_TAB_IDS = [
  "dashboard",
  "orders",
  "lines",
  "requisitions",
  "vendors",
  "partner-banks",
  "landed-costs",
  "supplier-intakes",
] as const

async function openPurchasingTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-purchasing-${tabId}`).click()
}

async function assertPurchasingTabRenders(page: Page, tabId: string) {
  await openPurchasingTab(page, tabId)
  await expectNoAppError(page)

  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-create_purchase_order")).toBeVisible()
      await expect(page.getByTestId("quick-action-view_vendors")).toBeVisible()
      break
    case "orders":
      await expect(page.getByTestId("module-create-purchasing-orders")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "lines":
      await expect(page.getByTestId("entity-table")).toBeVisible({ timeout: 30_000 })
      break
    case "requisitions":
      await expect(page.getByTestId("module-create-purchasing-requisitions")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "vendors":
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "partner-banks":
      await expect(page.getByTestId("module-create-purchasing-partner-banks")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "landed-costs":
      await expect(page.getByTestId("module-create-purchasing-landed-costs")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "supplier-intakes":
      await expect(page.getByTestId("module-create-purchasing-supplier-intakes")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    default:
      break
  }
}

test.describe("Purchasing module e2e", { tag: "@dev-fixture" }, () => {
  test("renders purchasing shell and key tabs without errors", async ({ page }) => {
    await gotoModule(page, "/purchasing", "purchasing")

    for (const tabId of PURCHASING_TAB_IDS) {
      await assertPurchasingTabRenders(page, tabId)
    }
  })

  test("dashboard quick action opens purchase order form", async ({ page }) => {
    await gotoModule(page, "/purchasing", "purchasing")
    await openPurchasingTab(page, "dashboard")

    await page.getByTestId("quick-action-create_purchase_order").click()
    await expect(page.getByTestId("form-modal-new-purchase-order")).toBeVisible()

    await page.getByTestId("form-modal-new-purchase-order").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-new-purchase-order")).toBeHidden()
    await expectNoAppError(page)
  })

  test("seeded purchase order appears on Purchase Orders tab", { tag: "@dev-fixture" }, async ({ page }) => {
    await gotoModule(page, "/purchasing", "purchasing")
    await openPurchasingTab(page, "orders")

    await expectSeededText(page, "PO/2024/0001", "/api/query/purchase-orders")
    await expectNoAppError(page)
  })

  test("landed costs create modal opens and cancel", async ({ page }) => {
    await openEntityCreate(page, "/purchasing", "purchasing", "landed-costs", "new-landed-cost")

    await page
      .getByTestId("form-modal-new-landed-cost")
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.getByTestId("form-modal-new-landed-cost")).toBeHidden()
    await expectNoAppError(page)
  })

  test("supplier intakes create modal opens and cancel", async ({ page }) => {
    await openEntityCreate(page, "/purchasing", "purchasing", "supplier-intakes", "new-supplier-intake")

    await page
      .getByTestId("form-modal-new-supplier-intake")
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.getByTestId("form-modal-new-supplier-intake")).toBeHidden()
    await expectNoAppError(page)
  })
})
