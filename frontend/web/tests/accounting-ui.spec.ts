import { test, expect, type Page } from "@playwright/test"

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }))
  expect(sizes.document).toBeLessThanOrEqual(sizes.width)
}

for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 768, height: 1000 }, { width: 1440, height: 1000 }]) {
  test.describe(`${viewport.width}px production components with synthetic data`, () => {
    test.use({ viewport, hasTouch: viewport.width < 1024 })

    test.beforeEach(async ({ page }) => {
      await page.goto("/")
      await expect(page.getByTestId("fixture-disclosure")).toContainText("no backend operations")
      await expect(page.getByTestId("fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
      await page.evaluate(async () => { await document.fonts.ready })
      await expect(page.getByTestId("workspace-header")).toBeVisible()
    })

    test("workspace groups expose secondary views and configuration without page overflow", async ({ page }, testInfo) => {
      await expect(page.getByTestId("module-tab-accounting-invoices")).toHaveCount(0)
      await page.getByTestId("module-workspace-accounting-receivables").click()
      await expect(page.getByTestId("module-tab-accounting-invoices")).toHaveAttribute("aria-selected", "true")
      await page.getByTestId("module-tab-accounting-credit-control").click()
      await expect(page.getByRole("tabpanel")).toContainText("Credit Control")
      await page.getByTestId("module-workspace-accounting-overflow").click()
      await page.getByTestId("module-workspace-item-accounting-fiscal-years").click()
      await expect(page.getByTestId("module-tab-accounting-fiscal-years")).toHaveAttribute("aria-selected", "true")
      await page.getByTestId("module-workspace-accounting-overview").click()
      await expectNoHorizontalOverflow(page)
      const border = await page.getByRole("navigation", { name: "Accounting workspaces" }).evaluate((element) => {
        const probe = document.createElement("span")
        probe.style.color = "hsl(var(--border))"
        element.append(probe)
        const expected = getComputedStyle(probe).color
        probe.remove()
        return { actual: getComputedStyle(element).borderTopColor, expected }
      })
      expect(border.actual).toBe(border.expected)
      await page.screenshot({ path: testInfo.outputPath(`accounting-${viewport.width}.png`), fullPage: true })
    })

    test("header search is reachable and workspace preferences survive reload", async ({ page }) => {
      await page.getByTestId("workspace-search").click()
      await expect(page.getByText("Search requested", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Workspace preferences", exact: true }).click()
      await page.getByRole("button", { name: "Full width", exact: true }).click()
      await page.getByRole("button", { name: "Dark", exact: true }).click()
      await page.getByRole("group", { name: "Table density", exact: true }).getByRole("button", { name: "Compact", exact: true }).click()
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("workspace-content")).toHaveAttribute("data-content-width", "full")
      await page.reload()
      await expect(page.getByTestId("workspace-content")).toHaveAttribute("data-content-width", "full")
      await expect(page.locator("html")).toHaveClass(/dark/)
      await expect(page.locator("html")).toHaveAttribute("data-density", "compact")
      await page.getByTestId("module-workspace-accounting-ledger").click()
      await expect(page.getByTestId("fixture-density-cell")).toHaveCSS("padding-top", "6px")
    })

    test("accountant queues preserve currency and permission boundaries and target exact bank records", async ({ page }, testInfo) => {
      const overview = page.getByTestId("accountant-overview")
      await expect(overview).toBeVisible()
      const activity = overview.getByRole("region", { name: "Document activity", exact: true })
      await expect(activity.getByRole("img")).toBeVisible()
      await activity.getByText("View monthly counts", { exact: true }).click()
      const activityTable = activity.getByRole("table", { name: "Document activity" })
      await expect(activityTable.getByRole("row", { name: "September 2026 2 0", exact: true })).toBeVisible()
      await expect(activityTable.getByRole("row", { name: "October 2026 0 1", exact: true })).toBeVisible()
      await activity.getByText("View monthly counts", { exact: true }).click()
      await expect(overview).not.toContainText("OTHER COMPANY MUST STAY HIDDEN")
      await expect(overview.getByRole("link", { name: /INV\/2026\/0101/ }).first()).toHaveAttribute("href", "/accounting/invoices/101")
      await expect(overview.getByRole("link", { name: /INV\/2026\/0102/ }).first()).toHaveAttribute("href", "/accounting/invoices/102")
      await expect(overview).toContainText("EUR")
      await expect(overview).toContainText("USD")
      await page.getByTestId("accountant-queue-unlinked-payments").click()
      await expect(page.getByRole("region", { name: "Payments without invoice links", exact: true })).toContainText("Access restricted")
      await expect(page.getByRole("region", { name: "Payments without invoice links", exact: true })).not.toContainText("Nothing waiting")
      await page.getByTestId("accountant-queue-bank-lines").click()
      await overview.getByRole("button", { name: /Incoming Acme transfer/ }).click()
      await expect(page.getByText("Synthetic bank selection: statement 201, line 301", { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`accounting-queue-${viewport.width}.png`), fullPage: true })
    })

    test("invoice composer updates its document preview and captures a synthetic draft", async ({ page }, testInfo) => {
      await page.getByRole("button", { name: "New invoice", exact: true }).click()
      await expect(page.getByTestId("create-invoice-modal")).toBeVisible()
      await expect(page.getByTestId("create-invoice-save-draft")).toBeDisabled()
      await page.getByTestId("create-invoice-partner").click()
      await page.getByRole("option", { name: "Acme Corporation", exact: true }).click()
      await page.getByTestId("create-invoice-line-description").fill("Alpha accounting support")
      await page.getByTestId("create-invoice-line-unit-price").fill("1250")
      if (viewport.width < 1024) await page.getByTestId("create-invoice-preview-toggle").click()
      const document = page.getByRole("article", { name: "Document preview" })
      await expect(document).toBeVisible()
      await expect(document).toContainText("Acme Corporation")
      await expect(document).toContainText("Alpha accounting support")
      await expect(document).toContainText("1,250.00")
      await expectNoHorizontalOverflow(page)
      const dialogSizes = await page.getByTestId("create-invoice-modal").evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }))
      expect(dialogSizes.scroll).toBeLessThanOrEqual(dialogSizes.width)
      await page.screenshot({ path: testInfo.outputPath(`invoice-${viewport.width}.png`), fullPage: true })
      await page.getByTestId("create-invoice-save-draft").click()
      await expect(page.getByTestId("create-invoice-modal")).toBeHidden()
      await expect(page.getByText("Synthetic draft captured", { exact: true })).toBeVisible()
    })

    test("document review keeps the draft next action reachable", async ({ page }, testInfo) => {
      await page.getByRole("button", { name: "Review invoice", exact: true }).click()
      const dialog = page.getByTestId("invoice-detail-modal")
      await expect(dialog).toContainText("INV/2026/0103")
      await expect(dialog).toContainText("Acme Corporation")
      await expect(dialog).toContainText("EUR")
      await expect(page.getByTestId("invoice-detail-post-draft")).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`invoice-review-${viewport.width}.png`), fullPage: true })
      await page.getByTestId("invoice-detail-post-draft").click()
      await page.keyboard.press("Escape")
      await expect(page.getByText("Synthetic posting requested", { exact: true })).toBeVisible()
    })

    if (viewport.width < 768) {
      test("mobile drawer closes on Escape, returns focus, and closes after navigation", async ({ page }) => {
        const toggle = page.getByTestId("workspace-navigation-toggle")
        await expect(page.getByTestId("dashboard-sidebar")).toBeHidden()
        await toggle.click()
        await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(page.getByTestId("dashboard-sidebar")).toBeHidden()
        await expect(toggle).toBeFocused()
        await toggle.click()
        await page.getByTestId("dashboard-sidebar").getByRole("link", { name: "Accounting", exact: true }).click()
        await expect(page).toHaveURL(/\/accounting$/)
        await expect(page.getByTestId("dashboard-sidebar")).toBeHidden()
        await expectNoHorizontalOverflow(page)
      })
    } else {
      test("desktop navigation collapse survives reload", async ({ page }) => {
        await page.getByTestId("workspace-navigation-toggle").click()
        await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible()
        await page.reload()
        await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible()
      })
    }
  })
}
