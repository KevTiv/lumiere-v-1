import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.goto("/kpi-integrity")
  await expect(page.getByTestId("kpi-integrity")).toHaveAttribute("data-hydrated", "true")
})

test("CRM and saved monetary KPIs keep currencies and fractional amounts separate", async ({ page }) => {
  const crm = page.getByTestId("kpi-tile-expectedRevenue-value")
  const saved = page.getByRole("region", { name: "Saved dashboard KPIs" })
  for (const locator of [crm, saved]) {
    await expect(locator).toContainText("100.25")
    await expect(locator).toContainText("200.50")
    await expect(locator).not.toContainText("300.75")
  }
  await page.getByLabel("Missing amount", { exact: true }).check()
  await expect(crm).toHaveText("—")
  await expect(saved.getByRole("alert")).toBeVisible()
  await expect(saved).not.toContainText("$0")
})

test("unavailable currencies suppress money while independently loaded CRM counts remain available", async ({ page }) => {
  await page.getByLabel("Currency denied", { exact: true }).check()
  await expect(page.getByTestId("kpi-tile-expectedRevenue-value")).toHaveText("—")
  await expect(page.getByTestId("kpi-tile-open-value")).toHaveText("2")
  await expect(page.getByRole("region", { name: "Saved dashboard KPIs" })).not.toContainText("100.25")
  await expect(page.getByTestId("saved-result-2")).toContainText("2")
})

test("task summary distinguishes ready zero from loading, denied, failed and partial reads", async ({ page }) => {
  const summary = page.getByTestId("task-summary")
  await summary.locator("summary").click()
  await expect(page.getByTestId("task-summary-total")).toHaveText("2")
  await expect(page.getByTestId("task-summary-overdue")).toHaveText("1")
  for (const state of ["loading", "denied", "error", "partial"]) {
    await page.getByLabel("Source state", { exact: true }).selectOption(state)
    await expect(page.getByTestId("kpi-tile-open-value")).toHaveText("—")
    if (state === "loading") await expect(page.getByTestId("task-summary-total")).toHaveText("")
    else await expect(page.getByTestId("task-summary-total")).toHaveCount(0)
  }
  await page.getByLabel("Source state", { exact: true }).selectOption("ready")
  await page.getByLabel("Empty records", { exact: true }).check()
  await expect(page.getByTestId("task-summary-total")).toHaveText("0")
})

test("empty saved averages and extrema never assert a numeric zero", async ({ page }) => {
  await page.getByLabel("Empty records", { exact: true }).check()
  const saved = page.getByRole("region", { name: "Saved dashboard KPIs" })
  for (const aggregation of ["average", "min", "max"]) {
    await page.getByLabel("Aggregation", { exact: true }).selectOption(aggregation)
    await expect(saved.getByRole("alert")).toBeVisible()
    await expect(saved).not.toContainText("$0")
  }
})
