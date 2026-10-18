import { expect, test } from "@playwright/test"

import { expectFormModalVisible, expectNoAppError, gotoModule, signIn, waitForBffQueryMinRows } from "./helpers"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, label: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await expect(
    page
      .getByTestId("dashboard-sidebar")
      .or(page.getByRole("button", { name: /menu|sidebar|navigation/i }))
      .first(),
    `${label} navigation remains reachable`,
  ).toBeVisible()
}

test.describe("COV-26 CRM/Sales resilience", { tag: ["@cov03", "@cov04", "@cov26", "@unauthenticated"] }, () => {
  for (const width of [320, 390] as const) {
    test(`CRM and Sales remain reachable by keyboard at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000)
      await signIn(page, "fixture.sales@example.test", PERSONA_PASSWORD)
      await page.setViewportSize({ width, height: 844 })

      await gotoModule(page, "/crm?tab=contacts", "crm")
      await expectNoHorizontalOverflow(page, `CRM at ${width}px`)
      const contactCreate = page.getByTestId("module-create-crm-contacts")
      await contactCreate.focus()
      await expect(contactCreate).toBeFocused()
      await contactCreate.press("Enter")
      await expectFormModalVisible(page, "new-contact")
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null))
        .toBe(true)
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("form-modal-new-contact")).toBeHidden()
      await expect(contactCreate).toBeFocused()

      await gotoModule(page, "/sales?tab=orders", "sales")
      await expectNoHorizontalOverflow(page, `Sales at ${width}px`)
      const orderCreate = page.getByTestId("module-create-sales-orders")
      await orderCreate.focus()
      await expect(orderCreate).toBeFocused()
      await orderCreate.press("Enter")
      await expectFormModalVisible(page, "new-sale-order")
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null))
        .toBe(true)
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("form-modal-new-sale-order")).toBeHidden()
      await expect(orderCreate).toBeFocused()
      await expectNoAppError(page)
    })
  }

  test("read-only persona cannot reach CRM or Sales mutation controls", async ({ page }) => {
    await signIn(page, "fixture.reader@example.test", PERSONA_PASSWORD)
    await gotoModule(page, "/crm?tab=contacts", "crm")
    await expect(page.getByTestId("module-create-crm-contacts")).toBeHidden()

    await gotoModule(page, "/sales?tab=orders", "sales")
    await expect(page.getByTestId("module-create-sales-orders")).toBeHidden()
    await expectNoAppError(page)
  })

  test("CRM and Sales refetch canonical data after an offline window", async ({ page, context }) => {
    test.setTimeout(120_000)
    await signIn(page, "fixture.sales@example.test", PERSONA_PASSWORD)

    await gotoModule(page, "/crm?tab=contacts", "crm")
    await waitForBffQueryMinRows(page, "/api/query/contacts")
    await context.setOffline(true)
    await page.waitForTimeout(500)
    await context.setOffline(false)
    const crmRefetch = page.waitForResponse(
      (response) => response.url().includes("/api/query/contacts") && response.ok(),
      { timeout: 30_000 },
    )
    await page.reload({ waitUntil: "domcontentloaded" })
    await crmRefetch
    await expect(page.getByTestId("module-tab-crm-contacts")).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByTestId("module-tab-crm-contacts")).toHaveAttribute("aria-selected", "true")

    await gotoModule(page, "/sales?tab=orders", "sales")
    await waitForBffQueryMinRows(page, "/api/query/sale-orders")
    await context.setOffline(true)
    await page.waitForTimeout(500)
    await context.setOffline(false)
    const salesRefetch = page.waitForResponse(
      (response) => response.url().includes("/api/query/sale-orders") && response.ok(),
      { timeout: 30_000 },
    )
    await page.reload({ waitUntil: "domcontentloaded" })
    await salesRefetch
    await expect(page.getByTestId("module-tab-sales-orders")).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByTestId("module-tab-sales-orders")).toHaveAttribute("aria-selected", "true")
    await expectNoAppError(page)
  })
})
