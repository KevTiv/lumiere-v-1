import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  chooseFirstOption,
  expectNoAppError,
  expectRecordAbsentFromQuery,
  fetchProductCategoryIdByName,
  fillField,
  openEntityCreate,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
} from "./helpers"

test.describe("Inventory update/delete mutations", { tag: ["@p0", "@phase-2"] }, () => {
  test("updates a product via edit-product and update_product reducer", async ({ page }) => {
    test.setTimeout(120_000)

    // Creates a fresh product (not seeded "Lumiere Dev Laptop") so the edit mutation
    // does not mutate seed data. Required selects hydrate from dev seed via
    // chooseFirstOption. If CI flakes on empty select options, switch this test to
    // select the seeded laptop row instead of creating a new product.
    const productName = smokeName("mut-product")
    const updatedName = `${productName}-updated`

    await gotoModule(page, "/inventory", "inventory")
    await page.getByTestId("module-tab-inventory-products").click()
    await waitForBffQueryMinRows(page, "/api/query/product-categories")
    await waitForBffQueryMinRows(page, "/api/query/uoms")
    await waitForBffQueryMinRows(page, "/api/query/pricelists")
    await page.getByTestId("module-create-inventory-products").click()
    await expect(page.getByTestId("form-modal-new-product")).toBeVisible()
    await fillField(page, "name", productName)
    await chooseFirstOption(page, "type")
    await chooseFirstOption(page, "categId")
    await chooseFirstOption(page, "uomId")
    await chooseFirstOption(page, "pricelistId")
    await fillField(page, "standardPrice", "10")

    const [createProductRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_product") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-product"),
    ])
    expect(createProductRes.ok()).toBe(true)
    await expect(page.getByText(productName).first()).toBeVisible({ timeout: 30_000 })

    await selectEntityRowByText(page, productName)
    await waitForEntityActionEnabled(page, "entity-action-edit-product")
    // Selecting a row opens the product detail sheet. Close it before invoking
    // the toolbar action; the sheet overlay otherwise intercepts the click.
    await page.keyboard.press("Escape")
    await page.getByTestId("entity-action-edit-product").click()
    await expect(page.getByTestId("form-modal-edit-product")).toBeVisible()
    await fillField(page, "name", updatedName)

    const [updateProductRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "update_product") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "edit-product"),
    ])
    expect(updateProductRes.ok()).toBe(true)

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/products")
          if (!res.ok()) return ""
          const json = (await res.json()) as { data?: Array<{ name?: string }> }
          const row = (json.data ?? []).find((product) =>
            String(product.name ?? "").includes(updatedName),
          )
          return row?.name ?? ""
        },
        { timeout: 30_000 },
      )
      .toContain(updatedName)

    await expect(page.getByText(updatedName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })

  test("deletes a product category via delete-category and delete_product_category reducer", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const categoryName = smokeName("mut-category")

    await openEntityCreate(page, "/inventory", "inventory", "product-categories", "new-product-category")
    await fillField(page, "name", categoryName)
    await submitForm(page, "new-product-category")
    await expect(page.getByText(categoryName).first()).toBeVisible({ timeout: 30_000 })

    const categoryId = await fetchProductCategoryIdByName(page, categoryName)
    await selectEntityRowById(page, categoryId)
    await waitForEntityActionEnabled(page, "entity-action-delete-category")

    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm")
      void dialog.accept()
    })

    const [deleteCategoryRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "delete_product_category") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-delete-category").click(),
    ])
    expect(deleteCategoryRes.ok()).toBe(true)

    await expectRecordAbsentFromQuery(page, "/api/query/product-categories", (row) =>
      scalarQueryId(row.id) === categoryId,
    )
    await expectNoAppError(page)
  })
})
