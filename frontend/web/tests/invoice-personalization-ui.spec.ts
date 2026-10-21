import { test, expect, type Page } from "@playwright/test"
// Exact fixture asset allowlist; all other /api/ requests fail the isolation assertion.
const syntheticLogoUrl = "/api/documents/blobs/object/7/synthetic/0123456789abcdef0123456789abcdef?sha256=f5438451863fbb1cb2224cbd6a823fa594b429dd3ce2f26c8c0f05bd3f971429"

const unexpectedRequests = new WeakMap<Page, string[]>()
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
}

for (const width of [320, 390, 768, 1440]) {
  test.describe(`${width}px real invoice personalization with synthetic persistence`, () => {
    test.use({ viewport: { width, height: width < 768 ? 844 : 1000 }, hasTouch: width < 1024 })
    test.beforeEach(async ({ page }) => {
      const requests: string[] = []
      unexpectedRequests.set(page, requests)
      page.on("request", (request) => {
        const url = new URL(request.url())
        if (url.pathname.startsWith("/api/") && `${url.pathname}${url.search}` !== syntheticLogoUrl) requests.push(request.url())
      })
      await page.goto("/personalization")
      await expect(page.getByTestId("personalization-fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
      await expect(page.getByTestId("invoice-profile-notice")).toHaveValue("Company A notice")
      await page.evaluate(async () => { await document.fonts.ready })
      await expect(page.locator("body")).toHaveCSS("font-family", /Geist/)
    })
    test.afterEach(async ({ page }) => {
      expect(unexpectedRequests.get(page), "Only the explicitly synthetic managed-shaped PNG may use an /api/ path; no ERP calls are permitted").toEqual([])
    })

    test("publishing preserves rejected edits and reconciles an exact unconfirmed save without redispatch", async ({ page }) => {
      const settings = page.getByTestId("invoice-profile-settings")
      await settings.getByTestId("invoice-profile-notice").fill("Company A revised notice")
      await settings.getByTestId("invoice-profile-logoUrl").setInputFiles({ name: "synthetic-logo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAFAAAAAgCAYAAACFM/9sAAAAZElEQVR4nO3QwQ3AIAwEQYpIe7zSfw1JBXwshDlpLO3fN+N556d6o/uB9AACBBgdwNOAq+seAjA0gAABRgcQIMDoAAIEGB1AgACj2wZYue7xAC8IIECA0QE8DSiAAG8KIECA0f2kEerU8nt7HQAAAABJRU5ErkJggg==", "base64") })
      await expect(page.getByText("Synthetic PNG upload callback for company 11", { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Reject next synthetic save", exact: true }).click()
      await settings.getByTestId("invoice-profile-save").click()
      await expect(settings.getByRole("alert")).toContainText("Synthetic publication rejected")
      await expect(settings.getByTestId("invoice-profile-notice")).toHaveValue("Company A revised notice")
      await expect(settings.getByTestId("invoice-profile-save")).toBeEnabled()
      await page.getByRole("button", { name: "Lose next synthetic response", exact: true }).click()
      await settings.getByTestId("invoice-profile-save").click()
      await expect(settings).toContainText("Publication result unconfirmed")
      await expect(settings.getByTestId("invoice-profile-save")).toHaveCount(0)
      await settings.getByRole("button", { name: "Check saved version", exact: true }).click()
      await expect(settings.getByRole("status")).toContainText("Published version")
      await expect(page.getByTestId("synthetic-publication-state")).toContainText("save callbacks 2; check callbacks 1; last scope 7:11")
      await settings.getByLabel("Settings scope", { exact: true }).selectOption("organization")
      await settings.getByLabel("Terms source", { exact: true }).selectOption("custom")
      await settings.getByTestId("invoice-profile-terms").fill("Organization revised terms")
      await settings.getByTestId("invoice-profile-save").click()
      await expect(page.getByTestId("synthetic-publication-state")).toContainText("last scope 7:organization")
      await settings.getByLabel("Settings scope", { exact: true }).selectOption("company")
      await expect(settings.getByTestId("invoice-profile-terms")).toHaveValue("Organization revised terms")
      await noOverflow(page)
    })

    test("late versions and company changes retain dirty edits but block cross-scope publication", async ({ page }) => {
      const settings = page.getByTestId("invoice-profile-settings")
      await settings.getByTestId("invoice-profile-notice").fill("Unsaved company A edits")
      await page.getByRole("button", { name: "Publish newer synthetic defaults", exact: true }).click()
      await expect(settings).toContainText("Your edits are retained")
      await expect(settings.getByTestId("invoice-profile-notice")).toHaveValue("Unsaved company A edits")
      await expect(settings.getByTestId("invoice-profile-save")).toBeDisabled()
      await page.getByRole("button", { name: "Switch synthetic company", exact: true }).click()
      await expect(settings).toContainText("The selected company changed")
      await expect(settings.getByTestId("invoice-profile-save")).toBeDisabled()
      await expect(page.getByTestId("synthetic-publication-state")).toContainText("save callbacks 0")
      await settings.getByRole("button", { name: "Discard edits and use selected company", exact: true }).click()
      await page.getByRole("button", { name: "Discard edits", exact: true }).click()
      await expect(settings.getByTestId("invoice-profile-notice")).toHaveValue("Company B notice")
      await settings.getByTestId("invoice-profile-notice").fill("Company B revised notice")
      await settings.getByTestId("invoice-profile-save").click()
      await expect(page.getByTestId("synthetic-publication-state")).toContainText("save callbacks 1; check callbacks 0; last scope 7:22")
      await page.getByRole("button", { name: "Toggle synthetic access", exact: true }).click()
      await expect(settings.getByTestId("invoice-profile-save")).toBeDisabled()
      await expect(settings.getByTestId("invoice-profile-notice")).toHaveCount(0)
      await noOverflow(page)
    })

    test("a dirty composer explicitly reviews defaults published in another fixture tab without losing overrides", async ({ page, context }) => {
      await page.getByRole("button", { name: "Compose synthetic invoice", exact: true }).click()
      const dialog = page.getByTestId("create-invoice-modal")
      await page.getByTestId("create-invoice-partner").click()
      await page.getByRole("option", { name: "Synthetic customer", exact: true }).click()
      await page.getByTestId("create-invoice-line-description").fill("Synthetic retained line")
      await page.getByTestId("create-invoice-line-unit-price").fill("1250")
      await dialog.getByRole("textbox", { name: "Terms", exact: true }).fill("Retained invoice-specific terms")
      await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()
      const publisher = await context.newPage()
      const publisherRequests: string[] = []
      publisher.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/") && `${url.pathname}${url.search}` !== syntheticLogoUrl) publisherRequests.push(request.url()) })
      try {
        await publisher.goto("/personalization")
        await expect(publisher.getByTestId("invoice-profile-notice")).toHaveValue("Company A notice")
        await publisher.getByRole("button", { name: "Publish newer synthetic defaults", exact: true }).click()
        await expect(dialog).toContainText("Company invoice settings changed")
        await expect(page.getByTestId("create-invoice-save-draft")).toBeDisabled()
        await expect(dialog.getByRole("textbox", { name: "Notice", exact: true })).toHaveValue("Company A notice")
        await expect(dialog.getByRole("textbox", { name: "Terms", exact: true })).toHaveValue("Retained invoice-specific terms")
        await dialog.getByRole("button", { name: "Apply current invoice defaults", exact: true }).click()
        await expect(dialog.getByRole("textbox", { name: "Notice", exact: true })).toHaveValue("Newer company notice")
        await expect(dialog.getByRole("textbox", { name: "Terms", exact: true })).toHaveValue("Retained invoice-specific terms")
        await expect(page.getByTestId("create-invoice-line-description")).toHaveValue("Synthetic retained line")
        await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()
        expect(publisherRequests, "The synthetic publisher must not call ERP APIs").toEqual([])
        await noOverflow(page)
      } finally { await publisher.close() }
    })

    test("long content, managed logo and light paper remain usable and issued snapshots ignore later defaults", async ({ page }, testInfo) => {
      await page.getByRole("button", { name: "Load long synthetic content", exact: true }).click()
      const settings = page.getByTestId("invoice-profile-settings")
      await expect(settings.getByTestId("invoice-profile-notice")).toHaveValue(/LONG-UNBROKEN-REFERENCE/)
      await noOverflow(page)
      await page.getByRole("button", { name: "Dark workspace", exact: true }).click()
      await expect(page.locator("html")).toHaveClass(/dark/)
      const paper = settings.getByTestId("invoice-document")
      await expect(paper).toHaveCSS("background-color", "rgb(255, 255, 255)")
      await expect(paper).toHaveCSS("color", "rgb(30, 41, 59)")
      const logo = paper.getByRole("img", { name: /logo$/ })
      await expect(logo).toHaveAttribute("src", syntheticLogoUrl)
      await logo.scrollIntoViewIfNeeded()
      await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(80)
      const controls = [settings.getByLabel("Settings scope", { exact: true }), settings.getByTestId("invoice-profile-notice"), settings.getByLabel("Accent source", { exact: true }), settings.getByTestId("invoice-profile-save")]
      if (width < 1024) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
        for (const control of controls) expect(await control.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      }
      await settings.getByLabel("Settings scope", { exact: true }).focus()
      await expect(settings.getByLabel("Settings scope", { exact: true })).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(settings.getByLabel("Logo source", { exact: true })).toBeFocused()
      await noOverflow(page)
      await page.getByRole("button", { name: "Compose synthetic invoice", exact: true }).click()
      const dialog = page.getByTestId("create-invoice-modal")
      await page.getByTestId("create-invoice-partner").click()
      await page.getByRole("option", { name: "Synthetic customer", exact: true }).click()
      await page.getByTestId("create-invoice-line-description").fill("Synthetic international support")
      await page.getByTestId("create-invoice-line-unit-price").fill("1250")
      await dialog.getByRole("textbox", { name: "Terms", exact: true }).fill("Explicit invoice-only terms")
      await dialog.getByRole("textbox", { name: "Footer", exact: true }).fill("")
      if (width < 1024) await page.getByTestId("create-invoice-preview-toggle").click()
      const preview = dialog.getByTestId("invoice-document")
      await expect(preview.getByRole("region", { name: "Terms", exact: true })).toContainText("Explicit invoice-only terms")
      await expect(preview.getByRole("region", { name: "Footer", exact: true })).toHaveCount(0)
      await expect(preview).toContainText("LONG-UNBROKEN-REFERENCE")
      if (width <= 390) {
        const layout = await preview.locator("header").evaluate((header) => {
          const seller = header.firstElementChild!.getBoundingClientRect()
          const reference = header.lastElementChild!.getBoundingClientRect()
          return { width: header.getBoundingClientRect().width, sellerWidth: seller.width, sellerBottom: seller.bottom, referenceTop: reference.top }
        })
        expect(layout.sellerWidth, "Narrow document headers must not crush seller identity beside the reference").toBeGreaterThanOrEqual(layout.width * 0.8)
        expect(layout.referenceTop, "The reference must wrap below seller identity in narrow document containers").toBeGreaterThanOrEqual(layout.sellerBottom)
      }
      if (width < 1024) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
        for (const control of [page.getByTestId("create-invoice-save-draft"), page.getByTestId("create-invoice-preview-toggle")]) expect(await control.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      }
      await noOverflow(page)
      if (width < 768) {
        await page.setViewportSize({ width, height: 480 })
        await page.getByTestId("create-invoice-save-draft").scrollIntoViewIfNeeded()
        await expect(page.getByTestId("create-invoice-save-draft")).toBeInViewport()
        await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport()
        await noOverflow(page)
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
        await page.setViewportSize({ width, height: 844 })
      }
      await page.getByTestId("create-invoice-save-draft").click()
      await expect(dialog).toBeHidden()
      const issued = page.getByRole("region", { name: "Synthetic issued snapshot", exact: true })
      await expect(issued).toContainText("Explicit invoice-only terms")
      await expect(issued.getByRole("region", { name: "Footer", exact: true })).toHaveCount(0)
      await expect(page.getByTestId("synthetic-invoice-content")).toContainText('"footer":""')
      await page.getByRole("button", { name: "Publish newer synthetic defaults", exact: true }).click()
      await expect(settings.getByTestId("invoice-profile-notice")).toHaveValue("Newer company notice")
      await expect(issued).toContainText("LONG-UNBROKEN-REFERENCE")
      await expect(issued).not.toContainText("Newer company notice")
      await issued.scrollIntoViewIfNeeded()
      await noOverflow(page)
      await page.getByRole("button", { name: "Compose synthetic invoice", exact: true }).click()
      await expect(dialog.getByRole("textbox", { name: "Notice", exact: true })).toHaveValue("Newer company notice")
      await expect(dialog.getByRole("textbox", { name: "Footer", exact: true })).toHaveValue("Newer company footer")
      if (width < 1024) expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true)
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()

      // Chromium's fullPage capture resets native touch emulation (coarse=true/maxTouchPoints=1 -> false/0).
      // Capture only after every functional assertion; other visual states are recorded outside regression timers.
      await issued.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`invoice-personalization-issued-${width}.png`), fullPage: true })
    })
  })
}
