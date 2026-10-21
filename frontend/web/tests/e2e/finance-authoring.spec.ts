import { expect, test, type Page } from "@playwright/test"
import { chooseSelectOptionByTriggerValue, fetchDefaultCompanyId, gotoModule, selectModuleTab } from "./helpers"

async function cancelDraft(page: Page) {
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  const discard = page.getByTestId("discard-changes-dialog")
  await expect(discard).toBeVisible()
  await page.getByTestId("discard-changes-confirm").click()
  await expect(discard).toBeHidden()
}

function observeOperationWrites(page: Page): string[] {
  const writes: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(?:api|v1)\/(?:operations|compat\/reducer)\//.test(new URL(request.url()).pathname)) writes.push(request.url())
  })
  return writes
}

async function openDraftDocument(page: Page, kind: "invoice" | "bill") {
  // Setup readiness comes from several asynchronous reads. Wait for the UI to open.
  await expect(async () => {
    await page.getByTestId(`quick-action-create_${kind}`).click()
    await expect(page.getByTestId("create-invoice-modal")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
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

  test("previews a new empty dashboard without saving placeholder widgets", async ({ page }) => {
    const writes = observeOperationWrites(page)
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-new_dashboard").click()
    const modal = page.getByTestId("form-modal-new-dashboard")
    await expect(modal).toBeVisible()
    await modal.getByTestId("form-field-name").fill("Monthly finance board")
    await modal.getByTestId("form-field-description").fill("Cash and collections review")
    const preview = modal.getByTestId("report-authoring-preview-dashboard")
    await expect(preview).toContainText("Monthly finance board")
    await expect(preview).toContainText("Cash and collections review")
    await expect(preview).toContainText("Start with an empty dashboard")
    await expect(preview).toContainText("Save the dashboard, then use Add widget")
    await expect(preview).toContainText("Unsaved")
    await cancelDraft(page)
    await expect(modal).toBeHidden()
    expect(writes).toEqual([])
  })

  test("previews supported widget sources and chart choices without saving", async ({ page }) => {
    const writes = observeOperationWrites(page)
    const companyId = await fetchDefaultCompanyId(page)
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-new_widget").click()
    const modal = page.getByTestId("form-modal-new-dashboard-widget")
    await expect(modal).toBeVisible()
    await modal.getByTestId("form-field-name").fill("Payments by status")
    await chooseSelectOptionByTriggerValue(page, modal.getByTestId("form-field-companyId"), companyId)
    await modal.getByTestId("form-field-dataSource").click()
    await expect(page.getByRole("option", { name: "Invoices, bills and journal entries", exact: true })).toBeVisible()
    await page.getByRole("option", { name: "Payments", exact: true }).click()
    const preview = modal.getByTestId("report-authoring-preview-widget")
    await expect(preview).toContainText("Number of records")
    await expect(preview).toContainText("Read-only preview of the selected company")
    await expect(preview.getByTestId("widget-authoring-live-preview-grid")).toBeVisible()
    await modal.getByTestId("form-field-widgetType").click()
    await expect(page.getByRole("option")).toHaveText(["KPI Card", "Chart", "Data Table"])
    await page.getByRole("option", { name: "Chart", exact: true }).click()
    await expect(modal.getByTestId("form-field-groupBy")).toContainText("Status")
    await modal.getByTestId("form-field-chartType").click()
    await page.getByRole("option", { name: "Donut", exact: true }).click()
    await expect(modal.getByTestId("form-field-chartType")).toContainText("Donut")
    await expect(preview.getByTestId("widget-authoring-live-preview-grid")).toBeVisible()
    await expect(preview.getByTestId("dashboard-widget-diagnostic")).toHaveCount(0)
    await cancelDraft(page)
    expect(writes).toEqual([])
  })

  for (const kind of ["invoice", "bill"] as const) {
    test(`previews the edited ${kind} document without creating a draft`, async ({ page }) => {
      test.setTimeout(90_000)
      const writes = observeOperationWrites(page)
      await gotoModule(page, "/accounting?tab=dashboard", "accounting")
      await openDraftDocument(page, kind)
      const modal = page.getByTestId("create-invoice-modal")
      await modal.getByTestId("create-invoice-partner").click()
      await page.getByRole("option", { disabled: false }).first().click()
      const partner = (await modal.getByTestId("create-invoice-partner").innerText()).trim()
      await modal.getByTestId("create-invoice-line-description").fill(`Authoring ${kind} line`)
      await modal.getByLabel("Item 1 quantity", { exact: true }).fill("2")
      await modal.getByTestId("create-invoice-line-unit-price").fill("125.50")
      await modal.locator("#create-invoice-date").fill("2026-10-20")
      await modal.locator("#create-invoice-due-date").fill("2026-11-20")
      if (await modal.getByTestId("create-invoice-preview-toggle").isVisible()) await modal.getByTestId("create-invoice-preview-toggle").click()
      const preview = modal.getByTestId("invoice-document")
      await expect(preview).toBeVisible()
      await expect(preview).toContainText(kind === "bill" ? "Vendor bill" : "Invoice")
      await expect(preview).toContainText(partner)
      await expect(preview).toContainText("2026-10-20")
      await expect(preview).toContainText("2026-11-20")
      await expect(preview.getByRole("row").nth(1).getByRole("cell").nth(0)).toHaveText(`Authoring ${kind} line`)
      await expect(preview.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText("2")
      await expect(preview.getByRole("row").nth(1).getByRole("cell").nth(2)).toContainText(/251[.,]00/)
      await expect(preview).toContainText("Draft document")
      await expect(preview).toContainText("Draft preview. Review and confirm totals before posting")
      if (await modal.getByRole("button", { name: "Edit details", exact: true }).isVisible()) await modal.getByRole("button", { name: "Edit details", exact: true }).click()
      await expect(modal.getByTestId("create-invoice-line-description")).toHaveValue(`Authoring ${kind} line`)
      await modal.getByLabel("Item 1 quantity", { exact: true }).fill("3")
      if (await modal.getByTestId("create-invoice-preview-toggle").isVisible()) await modal.getByTestId("create-invoice-preview-toggle").click()
      await expect(preview.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText("3")
      await expect(preview.getByRole("row").nth(1).getByRole("cell").nth(2)).toContainText(/376[.,]50/)
      await modal.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(modal).toBeHidden()
      expect(writes).toEqual([])
    })
  }

  test("keeps metric controls and preview within a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoModule(page, "/reports?tab=dashboard", "reports")
    await page.getByTestId("quick-action-new_metric").click()
    const modal = page.getByTestId("form-modal-new-analytics-metric")
    await expect(modal).toBeVisible()
    await page.getByTestId("metric-authoring-preview").scrollIntoViewIfNeeded()
    expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const previewBox = await page.getByTestId("metric-authoring-preview").boundingBox()
    expect(previewBox).not.toBeNull()
    expect(previewBox!.x).toBeGreaterThanOrEqual(0)
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(391)
    const cancel = modal.getByRole("button", { name: "Cancel", exact: true })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport()
    await cancel.click()
    await expect(modal).toBeHidden()
  })
})
