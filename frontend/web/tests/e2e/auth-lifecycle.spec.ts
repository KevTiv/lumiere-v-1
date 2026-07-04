import { expect, test } from "@playwright/test"

import { expectNoAppError } from "./helpers"

test.describe("auth lifecycle", { tag: "@unauthenticated" }, () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("sign-up page renders email/password form", async ({ page }) => {
    await page.goto("/sign-up")
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/^password/i).first()).toBeVisible()
    await expect(page.getByRole("button", { name: /sign up|create account/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("forgot-password page accepts email submission UI", async ({ page }) => {
    await page.goto("/forgot-password")
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /reset|send|submit/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("onboarding route redirects unauthenticated users to sign-in", async ({ page }) => {
    await page.goto("/onboarding")
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
