import { expect, test } from "@playwright/test"

import {
  expectAuthenticatedShell,
  gotoModule,
  installPostHogResetProbe,
  signIn,
} from "./helpers"

test.describe("ERP auth and shell smoke", () => {
  test("root landing page is public", async ({ page }) => {
    await page.goto("/")

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("heading", { name: /run your operations/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /create account/i })).toBeVisible()
  })

  test("overview redirects unauthenticated users to sign-in", async ({ page }) => {
    await page.goto("/overview")

    await expect(page).toHaveURL(/\/sign-in\?/)
    const url = new URL(page.url())
    expect(url.searchParams.get("callbackUrl")).toBe("/overview")
  })

  test("seeded user can sign in and see the authenticated shell", async ({ page }) => {
    await signIn(page)
    await expectAuthenticatedShell(page)
  })

  test("authenticated shell can open high-value module routes", async ({ page }) => {
    await signIn(page)

    await gotoModule(page, "/overview")

    const modules = [
      { route: "/crm", id: "crm" },
      { route: "/sales", id: "sales" },
      { route: "/inventory", id: "inventory" },
      { route: "/helpdesk", id: "helpdesk" },
      { route: "/proposals", id: "proposals" },
      { route: "/accounting", id: "accounting" },
    ]

    for (const module of modules) {
      await gotoModule(page, module.route, module.id)
    }

    await gotoModule(page, "/settings")
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible()
  })

  test("sign out resets analytics identity and returns to sign-in", async ({ page }) => {
    const resetProbe = await installPostHogResetProbe(page)
    await signIn(page)

    await page.getByTestId("sidebar-sign-out").click()

    await expect.poll(() => resetProbe.wasReset()).toBe(true)
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/)
  })
})
