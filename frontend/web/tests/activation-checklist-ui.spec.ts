import { test, expect } from "@playwright/test"

test("readiness alone keeps onboarding open and a verified outcome can be reopened", async ({ page }) => {
  await page.route("**/api/query/companies", route => route.fulfill({ json: { data: [
    { id: "2", organizationId: "1", currencyId: "4", fiscalYearEndMonth: 12, fiscalYearEndDay: 31 },
    { id: "3", organizationId: "1", currencyId: "4", fiscalYearEndMonth: 6, fiscalYearEndDay: 30 },
  ] } }))
  await page.route("**/api/query/contacts", route => route.fulfill({ json: { data: [
    { id: "9", organizationId: "1", companyId: "2", isCustomer: true },
  ] } }))
  let savedCompany = "3"
  await page.route("**/api/authoritative/contacts/9?companyId=2", route => route.fulfill({ json: { data:
    { id: "9", organizationId: "1", companyId: savedCompany },
  } }))
  await page.addInitScript(() => {
    localStorage.setItem("lumiere:activation:first-outcome:v1:fixture-actor:1:2", JSON.stringify({ task: "contact", recordId: "9" }))
  })
  await page.goto("/activation")
  const panel = page.getByTestId("activation-checklist")
  await expect(panel.locator('[data-check="contact"]')).toHaveAttribute("data-state", "ready")
  await page.getByRole("button", { name: "Compact completed setup", exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("The saved record could not be verified in this company")
  savedCompany = "2"
  await panel.getByRole("button", { name: "Refresh checks", exact: true }).click()
  await expect(panel).toBeHidden()
  await page.locator("summary").filter({ hasText: "Review setup and first tasks" }).click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("link", { name: "Open saved record" })).toHaveAttribute("href", "/crm?tab=contacts&filter=id%3A9")
  await page.getByRole("button", { name: "Company 3", exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-check="contact"]')).toHaveAttribute("data-state", "missing")
})

for (const width of [320, 390, 768, 1440]) {
  test(`activation keeps scope, role, task choice and layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route("**/api/query/companies", route => route.fulfill({ json: { data: [
      { id: "2", organizationId: "1", currencyId: "4", fiscalYearEndMonth: 12, fiscalYearEndDay: 31 },
      { id: "3", organizationId: "1", currencyId: "4", fiscalYearEndMonth: 6, fiscalYearEndDay: 30 },
    ] } }))
    let denied = false
    await page.route("**/api/query/contacts", route => denied
      ? route.fulfill({ status: 403, json: { error: "Denied" } })
      : route.fulfill({ json: { data: [{ id: "9", organizationId: "1", companyId: "2", isCustomer: true }] } }))
    await page.goto("/activation")
    const panel = page.getByTestId("activation-checklist")
    await expect(panel.locator('[data-check="company"]')).toHaveAttribute("data-state", "ready")
    await expect(panel.locator('[data-check="contact"]')).toHaveAttribute("data-state", "ready")
    await page.getByRole("button", { name: "Company 3", exact: true }).click()
    await expect(panel.locator('[data-check="contact"]')).toHaveAttribute("data-state", "missing")
    await page.getByRole("button", { name: "Company 2", exact: true }).click()
    const quotation = panel.getByRole("radio", { name: "Prepare a quotation", exact: true })
    await quotation.focus()
    await page.keyboard.press("Space")
    await expect(quotation).toBeChecked()
    await expect(page).toHaveURL(/activation=quotation/)
    await page.reload()
    await expect(panel.getByRole("radio", { name: "Prepare a quotation", exact: true })).toBeChecked()
    await expect(panel.getByRole("button", { name: "Prepare a quotation", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "No company", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Prepare a quotation", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Company 2", exact: true }).click()
    denied = true
    await panel.getByRole("button", { name: "Refresh checks", exact: true }).click()
    await expect(panel.locator('[data-check="customer"]')).toHaveAttribute("data-state", "unavailable")
    await page.getByRole("button", { name: "Toggle permissions", exact: true }).click()
    await expect(panel.getByRole("radio")).toHaveCount(0)
    await expect(panel).toContainText("Current permissions are unavailable")
    await page.getByRole("button", { name: "Toggle permissions", exact: true }).click()
    await expect(panel.getByRole("radio", { name: "Prepare a quotation", exact: true })).toBeChecked()
    const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))
    expect(sizes.document).toBeLessThanOrEqual(sizes.viewport)
    await page.screenshot({ path: testInfo.outputPath(`activation-${width}.png`), fullPage: true })
  })
}
