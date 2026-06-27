import { expect, test, type Page } from "@playwright/test"

import { expectNoAppError, gotoModule, openEntityCreate } from "./helpers"

const MANUFACTURING_KEY_TAB_IDS = [
  "dashboard",
  "orders",
  "bom-lines",
  "routing-operations",
] as const

async function openManufacturingTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-manufacturing-${tabId}`).click()
}

async function assertManufacturingTabRenders(page: Page, tabId: string) {
  await openManufacturingTab(page, tabId)
  await expectNoAppError(page)

  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-create_mo")).toBeVisible()
      await expect(page.getByTestId("quick-action-create_bom")).toBeVisible()
      break
    case "orders":
      await expect(page.getByTestId("module-create-manufacturing-orders")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "bom-lines":
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "routing-operations":
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    default:
      break
  }
}

test.describe("Manufacturing module e2e @phase-4", () => {
  test("renders manufacturing shell and key tabs without errors", async ({ page }) => {
    await gotoModule(page, "/manufacturing", "manufacturing")

    for (const tabId of MANUFACTURING_KEY_TAB_IDS) {
      await assertManufacturingTabRenders(page, tabId)
    }
  })

  test("dashboard quick action opens manufacturing order form and cancel", async ({ page }) => {
    await gotoModule(page, "/manufacturing", "manufacturing")
    await openManufacturingTab(page, "dashboard")

    await page.getByTestId("quick-action-create_mo").click()
    await expect(page.getByTestId("form-modal-new-manufacturing-order")).toBeVisible()

    await page
      .getByTestId("form-modal-new-manufacturing-order")
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.getByTestId("form-modal-new-manufacturing-order")).toBeHidden()
    await expectNoAppError(page)
  })

  test("orders tab create opens manufacturing order form and cancel", async ({ page }) => {
    await openEntityCreate(page, "/manufacturing", "manufacturing", "orders", "new-manufacturing-order")

    await page
      .getByTestId("form-modal-new-manufacturing-order")
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.getByTestId("form-modal-new-manufacturing-order")).toBeHidden()
    await expectNoAppError(page)
  })

  test("seeded manufacturing order opens row dialog when present", async ({ page }) => {
    await gotoModule(page, "/manufacturing", "manufacturing")
    await openManufacturingTab(page, "orders")

    const firstRow = page.locator('[data-testid^="entity-row-"]').first()
    const rowCount = await firstRow.count()
    test.skip(rowCount === 0, "No seeded manufacturing orders")

    await firstRow.click()
    await expect(page.locator('[data-testid^="form-modal-manufacturing-order-row-"]')).toBeVisible()

    await page
      .locator('[data-testid^="form-modal-manufacturing-order-row-"]')
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.locator('[data-testid^="form-modal-manufacturing-order-row-"]')).toHaveCount(0)
    await expectNoAppError(page)
  })
})
