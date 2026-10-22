import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"

const errors = new WeakMap<Page, string[]>()
const apiCalls = new WeakMap<Page, string[]>()
for (const width of [320, 390, 768, 1440]) {
  for (const module of ["sales", "crm", "purchasing", "expenses", "reports"] as const) {
    test.describe(`${width}px ${module} shared financial-style overview`, () => {
      test.use({ viewport: { width, height: 1000 }, hasTouch: width < 1024 })
      test.beforeEach(async ({ page }) => {
        const browserErrors: string[] = [], requests: string[] = []
        errors.set(page, browserErrors); apiCalls.set(page, requests)
        page.on("pageerror", (error) => browserErrors.push(error.message))
        page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()) })
        page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()) })
        await page.goto("/module-insights")
        await expect(page.getByTestId("module-insights-disclosure")).toHaveAttribute("data-hydrated", "true")
        await page.getByLabel("Synthetic module", { exact: true }).selectOption(module)
      })
      test.afterEach(async ({ page }) => {
        expect(errors.get(page), "No runtime or component contract errors").toEqual([])
        expect(apiCalls.get(page), "Synthetic previews must not call ERP APIs").toEqual([])
      })
      test("charts, currency/period scope, queues, exports, unavailable sources and retained workspaces", async ({ page }) => {
        const overview = page.getByTestId(`module-insights-${module}`)
        const trend = page.getByTestId(`${module}-insights-trend`)
        await expect(trend.locator(".recharts-area").first()).toBeVisible()
        await expect(page.getByTestId(`${module}-insights-states`).locator(".recharts-bar")).toHaveCount(1)
        await expect(page.getByText("LEGACY FIGURES MUST NOT RENDER")).toHaveCount(0)
        await expect(overview).not.toContainText("FOREIGN COMPANY MUST STAY HIDDEN")
        await expect(overview).not.toContainText("999999")
        await expect(page.getByRole("button", { name: "Export dashboard" })).toHaveCount(0)
        const csvEvent = page.waitForEvent("download")
        await trend.getByRole("button", { name: /as CSV/ }).click()
        const csv = await readFile((await (await csvEvent).path())!, "utf8")
        const provenance = JSON.parse(csv.split("\r\n")[0]!.slice("# lumiere-provenance:".length))
        expect(provenance.companyId).toBe("1")
        expect(JSON.parse(provenance.domain).currencyId).toBe(module === "reports" ? null : "1")
        expect(csv).not.toContain("999999")
        await trend.getByText("View chart data", { exact: true }).click()
        await expect(trend.getByRole("table")).toBeVisible()
        expect(await trend.getByRole("button", { name: /as CSV/ }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
        await page.getByLabel("Analysis period", { exact: true }).selectOption("30")
        await expect(page.getByTestId("module-insights-period-callback")).toContainText("2026-09-18T00:00:00.000Z")
        await expect(page.getByTestId("module-insights-period-callback")).toContainText("2026-10-18T00:00:00.000Z")
        await expect(page.getByTestId(`${module}-insights-periodValue`)).toContainText("Previous period")
        if (module !== "reports") {
          await expect(page.getByTestId(`${module}-insights-periodValue`)).toContainText("600.00 EUR")
          await page.getByLabel("Analysis currency", { exact: true }).selectOption("2")
          await expect(page.getByTestId(`${module}-insights-periodValue`)).toContainText("250.00 USD")
          await page.getByLabel("Analysis currency", { exact: true }).selectOption("1")
        } else await expect(page.getByLabel("Analysis currency", { exact: true })).toHaveCount(0)
        await page.getByTestId(`${module}-insights-queue-${module === "crm" ? "open" : "draft"}`).click()
        await expect(page.getByTestId(`${module}-insights-queue-records`).getByRole("link", { name: /exact u64/ })).toHaveAttribute("href", new RegExp("9007199254740993"))
        await page.getByRole("button", { name: "Toggle synthetic long names", exact: true }).click()
        await expect(page.getByTestId(`${module}-insights-queue-records`)).toContainText("Synthetic international")
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
        await page.getByRole("button", { name: "Toggle synthetic long names", exact: true }).click()
        await page.getByRole("button", { name: "Synthetic existing create action", exact: true }).click()
        await expect(page.getByTestId("module-insights-fixture-action")).toContainText("Synthetic existing create opened")
        if (module === "sales") {
          await overview.getByText("More operational queues", { exact: true }).click()
          await expect(overview.getByRole("link", { name: "Credit holds", exact: true })).toHaveAttribute("href", "/sales?tab=ops&queue=credit_holds")
          await expect(overview.getByRole("link", { name: "Commissions accrued", exact: true })).toHaveAttribute("href", "/sales?tab=ops&queue=commissions_accrued")
        }
        for (const state of ["loading", "denied", "error", "partial"]) {
          await page.getByLabel("Synthetic source", { exact: true }).selectOption(state)
          await expect(overview.locator(".recharts-wrapper")).toHaveCount(0)
          await expect(overview.getByRole("button", { name: /Export/ })).toHaveCount(0)
          await expect(page.getByTestId(`${module}-insights-queue-records`)).toHaveCount(0)
          await expect(page.getByTestId(`${module}-insights-periodValue`)).not.toContainText("EUR")
        }
        await page.getByLabel("Synthetic source", { exact: true }).selectOption("ready")
        await page.getByRole("button", { name: "Synthetic dark theme", exact: true }).click()
        await page.getByRole("button", { name: "Synthetic Ocean palette", exact: true }).click()
        await expect(page.locator("html")).toHaveClass(/dark/)
        const gradient = await trend.locator(".recharts-area-area").first().evaluate((element) => {
          const fill = element.getAttribute("fill") ?? ""
          const id = fill.match(/^url\(#([a-zA-Z0-9_-]+)\)$/)?.[1]
          return { fill, valid: Boolean(id && document.getElementById(id)?.tagName.toLowerCase() === "lineargradient") }
        })
        expect(gradient.valid, `Area fill must resolve to its own gradient: ${gradient.fill}`).toBe(true)
        const ticks = await page.getByTestId(`${module}-insights-states`).locator(".recharts-xAxis .recharts-cartesian-axis-tick-value tspan").allTextContents()
        expect(ticks.length).toBeGreaterThan(0)
        expect(ticks.every((tick) => Number.isInteger(Number(tick)))).toBe(true)
        const stroke = await trend.locator(".recharts-area-curve").first().evaluate((element) => getComputedStyle(element).stroke)
        const tokenColor = await page.evaluate(() => { const probe = document.createElement("span"); probe.style.color = "hsl(var(--chart-1))"; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color })
        expect(stroke).toBe(tokenColor)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
        await page.getByRole("button", { name: "Switch synthetic company", exact: true }).click()
        if (module !== "reports") {
          await expect(page.getByLabel("Analysis currency", { exact: true })).toHaveValue("2")
          await expect(page.getByLabel("Analysis period", { exact: true })).toHaveValue("90")
          await expect(page.getByTestId(`${module}-insights-periodValue`)).toContainText("375.00 USD")
          await expect(overview).not.toContainText("Synthetic exact u64 record")
        } else await expect(page.getByTestId(`${module}-insights-periodValue`)).toContainText("1")
        await page.getByRole("button", { name: "Toggle synthetic currency access", exact: true }).click()
        if (module !== "reports") await expect(overview.getByRole("button", { name: /Export/ })).toHaveCount(0)
        else await expect(trend.locator(".recharts-area").first()).toBeVisible()
        await page.getByRole("link", { name: "Existing records workspace", exact: true }).click()
        await expect(page.getByText("Original record workspace remains available.")).toBeVisible()
        await expect(overview).toHaveCount(0)
      })
    })
  }
}
