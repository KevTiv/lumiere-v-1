import { expect, test, type Page } from "@playwright/test"
import { gotoModule, selectModuleTab } from "./helpers"

async function cancelDraft(page: Page) {
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  const discard = page.getByTestId("discard-changes-dialog")
  await expect(discard).toBeVisible()
  await page.getByTestId("discard-changes-confirm").click()
  await expect(discard).toBeHidden()
}

test.describe("Finance authoring previews", { tag: "@dev-fixture" }, () => {
  test("edits a metric through both entry points without creating a record", async ({ page }) => {
    const writes: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/operations/")) writes.push(request.url())
    })
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-new_metric").click()
    const preview = page.getByTestId("metric-authoring-preview")
    await expect(preview).toBeVisible()
    await page.getByTestId("form-field-name").fill("Outstanding balance")
    await page.getByTestId("form-field-targetValue").fill("12000")
    await expect(preview).toContainText("Outstanding balance")
    await expect(preview).toContainText("12,000")
    await expect(preview).toContainText("Saves a definition only")
    await expect(preview.getByLabel("No calculated value", { exact: true })).toHaveText("—")
    await cancelDraft(page)

    await selectModuleTab(page, "reports", "analytics-metrics")
    await page.getByTestId("module-create-reports-analytics-metrics").click()
    await expect(preview).toBeVisible()
    await expect(page.getByTestId("form-field-name")).toHaveValue("")
    expect(writes).toEqual([])
  })

  test("shows the report structure as the title is edited", async ({ page }) => {
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-generate_report").click()
    await page.getByTestId("form-field-name").fill("October review")
    const preview = page.getByTestId("report-authoring-preview-report")
    await expect(preview).toContainText("October review")
    await expect(preview).toContainText("Layout preview only")
    await expect(preview.getByRole("table")).toBeVisible()
  })

  test("previews printable area and detects margins with no remaining space", async ({ page }) => {
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-new_template").click()
    await expect(page.getByTestId("template-page-preview")).toBeVisible()
    await page.getByTestId("form-field-marginTop").fill("300")
    await expect(page.getByTestId("report-authoring-preview-template")).toContainText("The margins leave no printable area")
  })

  test("previews report delivery recipients without sending a report", async ({ page }) => {
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-schedule_report").click()
    await page.getByTestId("form-field-recipients").fill("finance@example.test, owner@example.test")
    const preview = page.getByTestId("report-authoring-preview-schedule")
    await expect(preview).toContainText("finance@example.test")
    await expect(preview).toContainText("owner@example.test")
    await expect(preview).toContainText("Future run dates depend on the scheduler")
  })

  test("shows an interactive tax example without changing saved amounts", async ({ page }) => {
    await gotoModule(page, "/accounting?tab=taxes", "accounting")
    await page.getByTestId("module-create-accounting-taxes").click()
    await page.getByTestId("form-field-amount").fill("18")
    const preview = page.getByTestId("accounting-authoring-preview-new-tax")
    await expect(preview).toBeVisible()
    await expect(preview.getByRole("row", { name: "Total 118", exact: true })).toBeVisible()
    await preview.getByLabel("Example amount", { exact: true }).fill("200")
    await expect(preview.getByRole("row", { name: "Total 236", exact: true })).toBeVisible()
    await expect(page.getByTestId("form-field-amount")).toHaveValue("18")
  })

  test("keeps metric controls and preview within a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-new_metric").click()
    const modal = page.getByTestId("form-modal-new-analytics-metric")
    await expect(modal).toBeVisible()
    await page.getByTestId("metric-authoring-preview").scrollIntoViewIfNeeded()
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  })
})
