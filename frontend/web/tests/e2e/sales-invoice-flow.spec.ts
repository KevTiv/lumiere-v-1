import { expect, test } from "@playwright/test"

import { expectNoAppError, expectSeededText, gotoModule, openAccountingTab } from "./helpers"

/**
 * Smoke-level sales → invoice linkage checks.
 *
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`) for the
 * seeded SO/INV tests. The quick-action test does not depend on fixture rows.
 *
 * Seeded records:
 * - Sale order SO/2024/0001 (client ref ACME-2024-001, partner Acme Corporation)
 * - Customer invoice INV/2024/00001 linked via `invoice_origin` to SO/2024/0001
 *
 * Does not exercise full order-to-invoice creation; that path needs journals,
 * partners, and products beyond what a minimal smoke create can guarantee.
 */
test.describe("Sales and invoice flow e2e", { tag: "@dev-fixture" }, () => {
  test("seeded sale order is visible on Sales Orders tab", { tag: "@dev-fixture" }, async ({ page }) => {
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()

    await expectSeededText(page, "SO/2024/0001", "/api/query/sale-orders")
    await expect(page.getByText("ACME-2024-001")).toBeVisible()
    await expectNoAppError(page)
  })

  test("seeded customer invoice linked to sale order appears in Accounting Invoices", { tag: "@dev-fixture" }, async ({ page }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "invoices")
    await expect(page.getByRole("button", { name: /new invoice/i })).toBeVisible({ timeout: 30_000 })

    await expectSeededText(page, "INV/2024/00001", "/api/query/account-moves")
    await expect(page.getByText("Acme Corporation").first()).toBeVisible()
    await expect(page.getByRole("button", { name: /new invoice/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("sales dashboard quick action opens new sale order form", async ({ page }) => {
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-dashboard").click()

    await page.getByTestId("quick-action-create_sale_order").click()
    await expect(page.getByTestId("form-modal-new-sale-order")).toBeVisible()

    await page.getByTestId("form-modal-new-sale-order").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-new-sale-order")).toBeHidden()
    await expectNoAppError(page)
  })
})
