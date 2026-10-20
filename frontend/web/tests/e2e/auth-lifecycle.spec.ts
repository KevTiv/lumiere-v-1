import { expect, test } from "@playwright/test"

import { expectNoAppError } from "./helpers"

test.describe("auth lifecycle", { tag: "@unauthenticated" }, () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("private alpha redirects public sign-up and rejects native registration", async ({ page }) => {
    await page.goto("/sign-up")
    await expect(page).toHaveURL(/\/sign-in\?/)
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/sign-up")
    await expect(page.getByRole("button", { name: /^sign up$|^create account$/i })).toBeHidden()
    const rejected = await page.request.post("/api/auth/signup", {
      data: { email: "unapproved-alpha@example.test", password: "UnapprovedAlpha123!" },
    })
    expect(rejected.status()).toBe(410)
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
