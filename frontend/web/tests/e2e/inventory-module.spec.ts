import { expect, test, type Page } from "@playwright/test"

import { expectNoAppError, gotoModule, signIn } from "./helpers"

const INVENTORY_KEY_TAB_IDS = [
  "dashboard",
  "products",
  "product-categories",
  "stock",
  "transfers",
  "warehouses",
  "adjustments",
  "locations",
  "location-tree",
  "cycle-wizard",
  "quality-alerts",
] as const

async function openInventoryTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-inventory-${tabId}`).click()
}

async function assertInventoryTabRenders(page: Page, tabId: string) {
  await openInventoryTab(page, tabId)
  await expectNoAppError(page)

  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-create_product")).toBeVisible()
      await expect(page.getByTestId("quick-action-view_warehouses")).toBeVisible()
      break
    case "products":
      await expect(page.getByTestId("module-create-inventory-products")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "product-categories":
      await expect(page.getByTestId("module-create-inventory-product-categories")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "stock":
      await expect(page.getByTestId("module-create-inventory-stock")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "transfers":
      await expect(page.getByTestId("module-create-inventory-transfers")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "warehouses":
      await expect(page.getByTestId("module-create-inventory-warehouses")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "adjustments":
      await expect(page.getByTestId("module-create-inventory-adjustments")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "locations":
      await expect(page.getByTestId("module-create-inventory-locations")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "location-tree":
      await expect(page.getByText("Location hierarchy")).toBeVisible()
      break
    case "cycle-wizard":
      await expect(page.getByText("Cycle count")).toBeVisible()
      break
    case "quality-alerts":
      await expect(page.getByText("Quality alerts")).toBeVisible()
      break
    default:
      break
  }
}

test.describe("Inventory module e2e", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("renders inventory shell and key tabs without errors", async ({ page }) => {
    await gotoModule(page, "/inventory", "inventory")

    for (const tabId of INVENTORY_KEY_TAB_IDS) {
      await assertInventoryTabRenders(page, tabId)
    }
  })

  test("dashboard quick action opens new product form", async ({ page }) => {
    await gotoModule(page, "/inventory", "inventory")
    await openInventoryTab(page, "dashboard")

    await page.getByTestId("quick-action-create_product").click()
    await expect(page.getByTestId("form-modal-new-product")).toBeVisible()

    await page.getByTestId("form-modal-new-product").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-new-product")).toBeHidden()
    await expectNoAppError(page)
  })

  test("seeded product appears on Products tab", async ({ page }) => {
    // Requires `seed_dev_data` from `make e2e-smoke` (Lumiere Dev Laptop).
    await gotoModule(page, "/inventory", "inventory")
    await openInventoryTab(page, "products")

    await expect(page.getByText("Lumiere Dev Laptop")).toBeVisible()
    await expectNoAppError(page)
  })
})
