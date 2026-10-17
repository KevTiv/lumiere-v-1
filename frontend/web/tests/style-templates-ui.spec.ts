import { test, expect, type Page, type Locator } from "@playwright/test"

const apiRequests = new WeakMap<Page, string[]>()

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
}

async function expectToken(element: Locator, property: "borderTopColor" | "backgroundColor" | "color", token: string) {
  await expect.poll(async () => element.evaluate((node, args) => {
    const probe = document.createElement("span")
    probe.style.color = `hsl(var(${args.token}))`
    node.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return getComputedStyle(node)[args.property] === expected
  }, { property, token })).toBe(true)
}

for (const width of [320, 390, 768, 1440]) {
  test.describe(`${width}px shared template style propagation`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 1000 }, hasTouch: width < 1024 })
    test.beforeEach(async ({ page }) => {
      const requests: string[] = []
      apiRequests.set(page, requests)
      page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()) })
      // Hydration and font checks below define readiness for this fixture.
      await page.goto("/style-templates", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("style-fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
      await expect(page.getByTestId("module-view-style-templates")).toHaveAttribute("data-hydrated", "true")
      await page.evaluate(async () => { await document.fonts.ready })
      await expect(page.locator("body")).toHaveCSS("font-family", /Geist/)
    })
    test.afterEach(async ({ page }) => {
      expect(apiRequests.get(page), "Synthetic template previews must not call ERP APIs").toEqual([])
    })

    test("actual module, static form and persisted detail inherit palette and contain overflow", async ({ page }, testInfo) => {
      const module = page.getByTestId("module-view-style-templates")
      const title = module.locator('[data-ui="page-title"]')
      await expect(title).toBeVisible()
      expect(await title.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(width)
      if (width < 768) expect(await title.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(50)
      const action = page.getByTestId("template-long-action")
      const actionMetrics = await action.evaluate((node) => ({ height: node.clientHeight, contentHeight: node.scrollHeight, lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight) }))
      expect(actionMetrics.contentHeight).toBeLessThanOrEqual(actionMetrics.height)
      if (width <= 390) expect(actionMetrics.height).toBeGreaterThanOrEqual(actionMetrics.lineHeight * 3)
      const collection = page.getByTestId("composed-collection-suppliers")
      await expectToken(collection, "backgroundColor", "--card")
      await expectToken(collection, "borderTopColor", "--border")
      const tableScroll = collection.locator('[data-slot="table-container"]')
      expect(await tableScroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
      await expectNoOverflow(page)
      const row = page.getByTestId("composed-row-suppliers-supplier-1")
      await row.focus()
      await expect(row).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(page.getByTestId("composed-detail-value-supplier-detail-reference")).toHaveText("SUPPLIER-ALPHA-001")
      await expectNoOverflow(page)
      await page.getByTestId("composed-detail-supplier-detail").scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`templates-persisted-${width}.png`), fullPage: true })
      await page.getByTestId("module-workspace-style-templates-form").click()
      const inline = page.getByTestId("form-submit-template-inline")
      await expect(inline).toBeVisible()
      await expectToken(inline, "backgroundColor", "--primary")
      await page.getByTestId("module-workspace-style-templates-records").click()
      await page.getByTestId("workspace-content").evaluate((node) => node.parentElement?.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`templates-default-${width}.png`), fullPage: true })
    })

    test("coarse controls, modal footer and keyboard interactions remain usable", async ({ page }, testInfo) => {
      await page.getByTestId("module-create-style-templates-records").click()
      const modal = page.getByTestId("form-modal-template-record")
      const field = modal.getByTestId("form-field-reference")
      const select = modal.getByTestId("form-field-department")
      const submit = modal.getByTestId("form-submit-template-record")
      await field.fill("SUPPLIER-SYNTHETIC-002")
      await field.focus()
      await expect.poll(() => field.evaluate((node) => {
        const probe = document.createElement("span")
        probe.style.color = "hsl(var(--ring))"
        node.parentElement!.append(probe)
        const ring = getComputedStyle(probe).color
        probe.remove()
        const style = getComputedStyle(node)
        return style.boxShadow.includes(ring) && node.matches(":focus-visible")
      })).toBe(true)
      await page.keyboard.press("Tab")
      await expect(select).toBeFocused()
      await select.press("ArrowDown")
      await page.getByRole("option", { name: "Finance and accounting", exact: true }).click()
      if (width < 1024) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
        for (const control of [field, select, submit]) expect(await control.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
        const tab = page.getByTestId("module-workspace-style-templates-records")
        expect(await tab.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      }
      await submit.scrollIntoViewIfNeeded()
      const bounds = await submit.boundingBox()
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(width < 768 ? 844 : 1000)
      await expectNoOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`templates-form-${width}.png`), fullPage: true })
      if (width < 768) {
        // Compact-height proxy only; this does not emulate a native software keyboard.
        await page.setViewportSize({ width, height: 480 })
        await submit.scrollIntoViewIfNeeded()
        const cancel = modal.getByRole("button", { name: "Cancel", exact: true })
        for (const action of [cancel, submit]) {
          const actionBounds = await action.boundingBox()
          expect(actionBounds!.y).toBeGreaterThanOrEqual(0)
          expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(480)
        }
        await expectNoOverflow(page)
        await page.screenshot({ path: testInfo.outputPath(`templates-form-compact-${width}.png`), fullPage: true })
      }
      await submit.click()
      await expect(modal).toBeHidden()
      await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Synthetic supplier saved" })).toBeVisible()
    })

    test("dark and Ocean themes persist across actual template renderers", async ({ page }, testInfo) => {
      await page.getByRole("button", { name: "Dark theme", exact: true }).click()
      await page.getByRole("button", { name: "Ocean palette", exact: true }).click()
      await expect(page.locator("html")).toHaveClass(/dark/)
      await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean")
      await page.reload({ waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("style-fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
      await expect(page.locator("html")).toHaveClass(/dark/)
      await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean")
      await expectToken(page.getByTestId("composed-collection-suppliers"), "backgroundColor", "--card")
      await page.getByTestId("module-workspace-style-templates-form").click()
      await expectToken(page.getByTestId("form-submit-template-inline"), "backgroundColor", "--primary")
      await expectNoOverflow(page)
      await page.getByTestId("workspace-content").evaluate((node) => node.parentElement?.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`templates-ocean-dark-${width}.png`), fullPage: true })
      await page.getByRole("button", { name: "Lumière palette", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("data-palette", "default")
      await expectToken(page.getByTestId("form-submit-template-inline"), "backgroundColor", "--primary")
      await page.getByTestId("workspace-content").evaluate((node) => node.parentElement?.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`templates-lumiere-dark-${width}.png`), fullPage: true })
      await page.getByRole("button", { name: "Light theme", exact: true }).click()
      await page.getByRole("button", { name: "Ocean palette", exact: true }).click()
      await expect(page.locator("html")).not.toHaveClass(/dark/)
      await expectToken(page.getByTestId("form-submit-template-inline"), "backgroundColor", "--primary")
      await expectToken(page.getByTestId("composed-collection-suppliers"), "backgroundColor", "--card")
      await expectNoOverflow(page)
    })
  })
}
