import { chooseSelectOptionByTriggerValue } from "./e2e/helpers-legacy"
import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"

const unexpectedRequests = new WeakMap<Page, string[]>()
const browserErrors = new WeakMap<Page, string[]>()

for (const width of [320, 390, 768, 1440]) {
  test.describe(`${width}px financial insights with synthetic data`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width < 1024 })
    test.beforeEach(async ({ page }) => {
      const calls: string[] = []
      unexpectedRequests.set(page, calls)
      const errors: string[] = []
      browserErrors.set(page, errors)
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
      page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url()) })
      await page.goto("/insights")
      await expect(page.getByTestId("insights-fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
      await expect(page.getByTestId("insight-trend").locator(".recharts-area").first()).toBeVisible()
      expect(calls).toEqual([])
    })
    test.afterEach(async ({ page }) => {
      expect(unexpectedRequests.get(page), "Synthetic financial fixtures must not call ERP APIs").toEqual([])
      expect(browserErrors.get(page), "Financial views must render without runtime or accessibility errors").toEqual([])
    })

    test("real shared charts render, currency and period controls retain correct balances and queues", async ({ page }) => {
      const insights = page.getByTestId("accountant-insights")
      await expect(page.getByTestId("insight-open-invoices")).toContainText("1,200.00 EUR")
      await expect(page.getByTestId("insight-posted-invoices")).toContainText("2,400.00 EUR")
      await expect(page.getByTestId("insight-aging").locator(".recharts-bar")).toHaveCount(2)
      await expect(page.getByTestId("insight-budgets").locator(".recharts-bar")).toHaveCount(2)
      await expect(page.getByRole("link", { name: "Open budgets", exact: true })).toHaveAttribute("href", "/accounting?tab=budgets")
      await chooseSelectOptionByTriggerValue(
        page,
        page.getByLabel("Analysis period", { exact: true }),
        "30",
      )
      await expect(page.getByTestId("insight-posted-invoices")).toContainText("0.00 EUR")
      await expect(page.getByTestId("insight-posted-invoices")).toContainText("2,400.00 EUR") // Previous period, not current.
      await expect(page.getByTestId("insight-open-invoices")).toContainText("1,200.00 EUR")
      await chooseSelectOptionByTriggerValue(
        page,
        page.getByLabel("Analysis currency", { exact: true }),
        "2",
      )
      await expect(page.getByTestId("insight-open-invoices")).toContainText("800.00 USD")
      await expect(page.getByTestId("insight-budgets")).toContainText("Select the company currency (EUR)")
      await expect(page.getByTestId("insight-budgets").getByRole("button", { name: /Export/ })).toHaveCount(0)
      await expect(insights).not.toContainText("OTHER COMPANY MUST STAY HIDDEN")
      await page.getByTestId("accountant-queue-bank-lines").click()
      await page.getByRole("button", { name: /Incoming Acme transfer/ }).click()
      await expect(page.getByTestId("insights-fixture-action")).toContainText("Synthetic bank line: 301")
      await page.getByTestId("accountant-queue-draft-invoices").click()
      await expect(page.getByRole("link", { name: /Draft customer invoice/ }).first()).toHaveAttribute("href", "/accounting/invoices/103")
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      for (const control of [page.getByLabel("Analysis currency", { exact: true }), page.getByLabel("Analysis period", { exact: true })]) expect(await control.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    })

    test("exports retain exact currency scope and source loss removes cached charts and export actions", async ({ page }) => {
      const trend = page.getByTestId("insight-trend")
      const downloadEvent = page.waitForEvent("download")
      await trend.getByRole("button", { name: /as CSV/ }).click()
      const download = await downloadEvent
      const csv = await readFile((await download.path())!, "utf8")
      const provenance = JSON.parse(csv.split("\r\n")[0]!.slice("# lumiere-provenance:".length))
      expect(JSON.parse(provenance.domain).currencyId).toBe("1")
      expect(provenance.companyId).toBe("1")
      expect(csv).toContain("2400")
      expect(csv).not.toContain("999999")
      for (const state of ["loading", "denied", "error", "partial"]) {
        await page.getByLabel("Synthetic document source", { exact: true }).selectOption(state)
        await expect(trend.locator(".recharts-wrapper")).toHaveCount(0)
        await expect(trend.getByRole("button", { name: /Export/ })).toHaveCount(0)
        await expect(page.getByTestId("insight-open-invoices")).not.toContainText("1,200.00")
      }
      await page.getByLabel("Synthetic document source", { exact: true }).selectOption("ready")
      await expect(trend.locator(".recharts-area").first()).toBeVisible()
      await page.getByRole("button", { name: "Toggle synthetic currency access", exact: true }).click()
      await expect(page.getByTestId("accountant-insights").getByRole("button", { name: /Export/ })).toHaveCount(0)
    })

    test("accessible tables, dark identity and company switching preserve scope without horizontal overflow", async ({ page }) => {
      const budgets = page.getByTestId("insight-budgets")
      await budgets.getByText("View chart data", { exact: true }).click()
      await expect(budgets.getByRole("table")).toContainText("Synthetic operating budget")
      await expect(budgets.getByRole("table")).toContainText("12,000.00 EUR")
      const exportButton = budgets.getByRole("button", { name: /as CSV/ })
      expect(await exportButton.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      await page.getByRole("button", { name: "Synthetic dark theme", exact: true }).click()
      await expect(page.locator("html")).toHaveClass(/dark/)
      const stroke = await page.getByTestId("insight-trend").locator(".recharts-area-curve").first().evaluate((element) => getComputedStyle(element).stroke)
      const themeStroke = await page.evaluate(() => {
        const probe = document.createElement("span")
        probe.style.color = "hsl(var(--chart-1))"
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      })
      expect(stroke).toBe(themeStroke)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      await chooseSelectOptionByTriggerValue(
        page,
        page.getByLabel("Analysis currency", { exact: true }),
        "1",
      )
      await page.getByRole("button", { name: "Switch synthetic company", exact: true }).click()
      await expect(page.getByLabel("Analysis currency", { exact: true })).toContainText("USD")
      await expect(page.getByTestId("insight-open-invoices")).toContainText("250.00 USD")
      await expect(page.getByTestId("insight-open-invoices")).not.toContainText("1,200.00")
    })
  })
}
