import { expect, test, type Page } from "@playwright/test"

import { gotoModule, openAccountingTab, scalarQueryId } from "./helpers"

async function deprecatedState(page: Page, accountId: number): Promise<boolean> {
  const response = await page.request.get("/api/query/account-accounts")
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { data?: Array<Record<string, unknown>> }
  const matches = (payload.data ?? []).filter((row) => scalarQueryId(row.id) === accountId)
  expect(matches).toHaveLength(1)
  return matches[0]?.deprecated === true
}

test.describe("chart-of-accounts deprecation readback @p0", () => {
  test("the row action proves the exact account state and can restore it", async ({ page }) => {
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "accounts")

    const firstButton = page.locator('[data-testid^="account-toggle-deprecated-"]').first()
    await expect(firstButton).toBeVisible()
    const testId = await firstButton.getAttribute("data-testid")
    const accountId = Number(testId?.replace("account-toggle-deprecated-", ""))
    expect(Number.isSafeInteger(accountId)).toBe(true)
    const button = page.getByTestId(`account-toggle-deprecated-${accountId}`)
    await expect(button).toBeEnabled()

    const initial = await deprecatedState(page, accountId)
    try {
      await button.click()
      if (!initial) await page.getByTestId("confirm-dialog-confirm").click()

      await expect.poll(() => deprecatedState(page, accountId), { timeout: 30_000 }).toBe(!initial)
      await expect(button).toHaveAttribute(
        "aria-label",
        !initial ? /Reactivate account/i : /Deprecate account/i,
      )
    } finally {
      const current = await deprecatedState(page, accountId)
      if (current !== initial) {
        await button.click()
        if (!current) await page.getByTestId("confirm-dialog-confirm").click()
        await expect.poll(() => deprecatedState(page, accountId), { timeout: 30_000 }).toBe(initial)
      }
    }
  })
})
