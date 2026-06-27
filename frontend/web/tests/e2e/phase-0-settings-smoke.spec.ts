import { expect, test } from "@playwright/test"

import { expectNoAppError, gotoModule, openSettingsSection } from "./helpers"

/** Polished settings sections from `settings-module.tsx` / `rbac-defaults.ts`. */
const KEY_SETTINGS_SECTION_IDS = [
  "users",
  "organization",
  "audit",
  "profile",
  "roles",
] as const

test.describe("ERP phase-0 settings smoke @phase-0", () => {
  test("settings shell renders at /settings", async ({ page }) => {
    await gotoModule(page, "/settings")

    await expect(page.getByRole("heading", { name: /^settings$/i, level: 1 })).toBeVisible()
    await expect(page.getByText(/manage your account and system configuration/i)).toBeVisible()
    await expectNoAppError(page)
  })

  test("key settings sections render without app errors", async ({ page }) => {
    for (const sectionId of KEY_SETTINGS_SECTION_IDS) {
      await openSettingsSection(page, sectionId)
      await expect(page.getByRole("button", { name: /back to settings/i })).toBeVisible()
    }

    await page.goto("/settings")
    await expect(page.getByRole("heading", { name: /google drive & whatsapp business/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("invite user dialog opens and cancels without submitting", async ({ page }) => {
    await openSettingsSection(page, "users")

    const addUser = page.getByRole("button", { name: /add user/i })
    if ((await addUser.count()) === 0) {
      test.skip(true, "Test user lacks admin:users create permission")
    }

    await addUser.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: /create new user/i })).toBeVisible()

    await dialog.getByRole("button", { name: /^cancel$/i }).click()
    await expect(dialog).toBeHidden()
    await expectNoAppError(page)
  })
})
