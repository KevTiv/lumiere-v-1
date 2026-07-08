import { expect, test } from "@playwright/test"

import {
  activeTabEntityTable,
  assertModuleTabs,
  expectNoAppError,
  expectSeededText,
  gotoModule,
  openAccountingTab,
  openTabAndCancelCreate,
} from "./helpers"

const SALES_FINANCE_TAB_IDS = ["fulfillment", "returns", "invoices"] as const

test.describe("ERP phase-7 finance smoke @phase-7", () => {
  test("sales fulfillment, returns, and invoices tabs render without errors", async ({ page }) => {
    await gotoModule(page, "/sales", "sales")

    await assertModuleTabs(page, "sales", SALES_FINANCE_TAB_IDS, async (_tabPage, tabId) => {
      switch (tabId) {
        case "fulfillment":
        case "returns":
          await expect(activeTabEntityTable(page)).toBeVisible()
          break
        case "invoices":
          break
        default:
          break
      }
    })
  })

  /**
   * Requires `seed_dev_data` from `make e2e-smoke`, which seeds customer invoice
   * INV/2024/00001 linked to sale order SO/2024/0001 (see sales-invoice-flow.spec.ts).
   */
  test("seeded customer invoice appears on Sales Invoices tab", async ({ page }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-invoices").click()
    await expect(page.getByText(/total invoices|invoices/i).first()).toBeVisible({ timeout: 30_000 })

    await expectSeededText(page, "INV/2024/00001", "/api/query/account-moves")
    await expectNoAppError(page)
  })

  test("reconciliation widget create modal opens and cancels", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openTabAndCancelCreate(page, "accounting", "reconciliation-widgets", "new-reconciliation-widget")
  })
})
