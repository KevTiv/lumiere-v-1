import { expect as baseExpect, test } from "@playwright/test"
import { selectModuleTab } from "./e2e/helpers"

const expect = baseExpect.configure({ timeout: 15_000 })

test("domain tab helper selects the module panel alongside nested and independent panels", async ({ page }) => {
  await page.goto("/navigation?module=sales")
  await expect(page.getByTestId("navigation-disclosure")).toHaveAttribute("data-hydrated", "true")
  // The fixture has both an independent local workspace and nested chart tabs.
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(3)
  await selectModuleTab(page, "sales", "dashboard")
  await expect(page.getByTestId("module-panel-sales-dashboard")).toBeVisible()
  await page.getByTestId("fixture-chart-trend").click()
  await selectModuleTab(page, "sales", "dashboard")
  await expect(page.getByTestId("fixture-chart-trend-panel")).toBeVisible()
})

for (const width of [320, 390, 768, 1440]) {
  test(`consistent workspaces, history, overflow and touch targets at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 950 })
    const apiRequests: string[] = []
    page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()) })
    await page.goto("/navigation?module=sales&company=7&tab=order-lines&filter=state:draft&highlight=2")
    await expect(page.getByTestId("navigation-disclosure")).toHaveAttribute("data-hydrated", "true")
    await expect(page.getByTestId("module-workspace-sales-orders")).toHaveAttribute("aria-current", "page")
    await expect(page.getByTestId("module-tab-sales-order-lines")).toHaveAttribute("aria-selected", "true")
    await page.getByTestId("module-workspace-sales-fulfillment").click()
    await expect(page).toHaveURL(/company=7&tab=deliveries$/)
    await page.goBack()
    await expect(page.getByTestId("module-tab-sales-order-lines")).toHaveAttribute("aria-selected", "true")
    await page.goForward()
    await expect(page.getByTestId("module-tab-sales-deliveries")).toHaveAttribute("aria-selected", "true")
    await page.reload()
    await expect(page.getByTestId("module-workspace-sales-fulfillment")).toHaveAttribute("aria-current", "page")

    let sharedNavClass: string | null = null
    for (const module of ["accounting", "sales", "crm", "purchasing", "reports", "expenses", "uncurated"]) {
      await page.getByLabel("Module", { exact: true }).selectOption(module)
      await page.waitForURL((url) => url.searchParams.get("module") === module)
      const root = page.getByTestId(`module-view-${module}`)
      await expect(root).toHaveAttribute("data-hydrated", "true")
      const nav = root.locator('[data-ui="workspace-nav"]')
      const className = await nav.getAttribute("class")
      if (sharedNavClass) expect(className).toBe(sharedNavClass)
      sharedNavClass = className
      const links = nav.getByRole("link")
      expect(await links.count()).toBeLessThanOrEqual(7)
      if (module !== "uncurated") await expect(links.first()).toHaveText("Overview")
      for (const link of await links.all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        const destination = new URL((await link.getAttribute("href"))!, page.url()).href
        await link.click()
        await page.waitForURL(destination)
        await expect(link).toHaveAttribute("aria-current", "page")
        const local = root.getByTestId(`module-tabs-${module}`).getByRole("tab")
        for (const tab of await local.all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        if (await local.count() > 1) {
          await local.first().focus()
          await page.keyboard.press("ArrowRight")
          await expect(local.nth(1)).toBeFocused()
          await page.keyboard.press("Enter")
          const tabId = (await local.nth(1).getAttribute("data-testid"))!.replace(`module-tab-${module}-`, "")
          await page.waitForURL((url) => url.searchParams.get("tab") === tabId)
          await expect(local.nth(1)).toHaveAttribute("aria-selected", "true")
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      }
      await root.getByTestId(`module-workspace-${module}-overflow`).click()
      await page.getByRole("menuitem", { name: "future-extension", exact: true }).click()
      await page.waitForURL((url) => url.searchParams.get("tab") === "future-extension")
      await expect(root.getByTestId(`module-tab-${module}-future-extension`)).toHaveAttribute("aria-selected", "true")
      await expect(page.getByTestId("navigation-content")).toContainText("future-extension content")
      await expect(page.getByRole("menu")).toHaveCount(0)
    }
    await page.getByLabel("Module", { exact: true }).selectOption("sales")
    const local = page.getByTestId("local-module-shell")
    await local.getByRole("tab", { name: "Administration", exact: true }).click()
    await expect(local.getByRole("tabpanel")).toContainText("Synthetic administration")
    const workspace = page.getByTestId("module-workspace-sales-overview")
    const appearance = (node: Element) => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, radius: style.borderRadius, color: style.color, font: style.fontSize, weight: style.fontWeight }
    }
    const expectedAppearance = await workspace.evaluate(appearance)
    // Selection animates through intermediate colours; compare the settled state.
    await expect.poll(() => local.getByRole("tab", { name: "Administration", exact: true }).evaluate(appearance)).toEqual(expectedAppearance)
    await page.getByRole("button", { name: "Toggle long labels" }).click()
    await page.getByRole("button", { name: "Dark Ocean appearance" }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath(`workspace-navigation-${width}.png`), fullPage: true })
    expect(apiRequests).toEqual([])
  })
}
