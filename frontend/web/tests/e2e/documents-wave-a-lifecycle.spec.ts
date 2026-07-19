import { test, expect } from "@playwright/test"

/**
 * Documents Wave A — upload form requires a file; attach panel surfaces on sales chatter.
 * Full blob+reducer e2e needs running api-server + STDB; this smoke validates UI contracts.
 */
test.describe("documents wave A lifecycle", () => {
  test("documents module exposes file upload on create form", async ({ page }) => {
    await page.goto("/documents")
    await expect(page.getByRole("heading", { name: /documents/i }).first()).toBeVisible({
      timeout: 60_000,
    })

    const uploadBtn = page.getByRole("button", { name: /upload document|new document/i }).first()
    if (await uploadBtn.isVisible().catch(() => false)) {
      await uploadBtn.click()
      await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 15_000 })
    } else {
      // Tab create action
      const docsTab = page.getByRole("tab", { name: /^documents$/i }).first()
      if (await docsTab.isVisible().catch(() => false)) {
        await docsTab.click()
      }
      const createBtn = page.getByRole("button", { name: /upload|create|new/i }).first()
      await createBtn.click()
      await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 15_000 })
    }
  })
})
