import { expect, test } from "@playwright/test"

import { expectNoAppError, gotoModule, signIn } from "./helpers"

test.describe("Phase 10 overview smoke", { tag: "@phase-10" }, () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("overview dashboard renders KPI and chart widgets", async ({ page }) => {
    await gotoModule(page, "/overview")
    await expect(page.getByTestId("overview-dashboard")).toBeVisible()
    await expect(page.getByTestId("overview-widget-overview-stat-cards")).toBeVisible()
    await expect(page.getByTestId("overview-widget-overview-sales-trend")).toBeVisible()
    await expect(page.getByTestId("overview-widget-overview-pipeline-mix")).toBeVisible()
    await expectNoAppError(page)
  })

  test("overview quick link navigates to a module route", async ({ page }) => {
    await gotoModule(page, "/overview")
    await page.getByTestId("quick-action-sales").click()
    await expect(page).toHaveURL(/\/sales/)
    await expect(page.getByTestId("module-view-sales")).toBeVisible()
    await expectNoAppError(page)
  })

  test("documents knowledge categories CSV import modal opens and cancels", async ({ page }) => {
    await gotoModule(page, "/documents", "documents")
    await page.getByTestId("module-tab-documents-knowledge-categories").click()
    await page.getByTestId("entity-action-csv-kb-category-tab").click()

    const csvModal = page.locator('[data-testid^="form-modal-csv-import-"]')
    await expect(csvModal).toBeVisible()
    await csvModal.getByRole("button", { name: /^cancel$/i }).click()
    await expect(csvModal).toBeHidden()
    await expectNoAppError(page)
  })

})
