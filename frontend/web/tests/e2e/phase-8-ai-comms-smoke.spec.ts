import { expect, test } from "@playwright/test"

import { expectNoAppError, gotoModule } from "./helpers"

test.describe("Phase 8 AI and communications smoke", { tag: "@phase-8" }, () => {
  test("ai-skills page loads and create skill modal opens then cancels", async ({ page }) => {
    await page.goto("/ai-skills")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await expectNoAppError(page)

    await page.getByTestId("ai-skills-create").click()
    await expect(page.getByTestId("form-modal-ai-skills-create")).toBeVisible()
    await page.getByTestId("form-modal-ai-skills-create").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-ai-skills-create")).toBeHidden()
    await expectNoAppError(page)
  })

  test("ai-skills assign and set-active modals open then cancel when available", async ({ page }) => {
    await page.goto("/ai-skills")
    await expectNoAppError(page)

    await page.getByTestId("ai-skills-assign").click()
    await expect(page.getByTestId("form-modal-ai-skills-assign")).toBeVisible()
    await page.getByTestId("form-modal-ai-skills-assign").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-ai-skills-assign")).toBeHidden()

    const setActiveButtons = page.getByTestId("ai-skills-set-active")
    if ((await setActiveButtons.count()) > 0) {
      await setActiveButtons.first().click()
      await expect(page.getByTestId("form-modal-ai-skills-set-active")).toBeVisible()
      await page.getByTestId("form-modal-ai-skills-set-active").getByRole("button", { name: /^cancel$/i }).click()
      await expect(page.getByTestId("form-modal-ai-skills-set-active")).toBeHidden()
    }

    await expectNoAppError(page)
  })

  test("messages module renders and followers tab is visible", async ({ page }) => {
    await gotoModule(page, "/messages", "messages")
    await page.getByTestId("module-tab-messages-followers").click()
    await expect(page.getByTestId("module-create-messages-followers")).toBeVisible()
    await expect(page.getByTestId("entity-table")).toBeVisible()
    await expectNoAppError(page)
  })

  test("settings integrations section renders without error", async ({ page }) => {
    await page.goto("/settings")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await expect(page.getByRole("heading", { name: /google drive & whatsapp business/i })).toBeVisible()
    await expectNoAppError(page)
  })
})
