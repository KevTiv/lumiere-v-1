import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  openAccountingTab,
  scalarQueryId,
} from "./helpers"

async function createDeprecationFixtureAccount(page: Page): Promise<number> {
  const organizationId = await fetchSessionOrganizationId(page)
  const companyId = await fetchDefaultCompanyId(page)
  const response = await page.request.get("/api/query/account-accounts")
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { data?: Array<Record<string, unknown>> }
  const template = (payload.data ?? []).find((row) => row.code === "5000")
  const userTypeId = scalarQueryId(template?.userTypeId ?? template?.user_type_id)
  if (userTypeId == null) throw new Error("account template 5000 has no user type")

  const code = `D${Date.now().toString(36).slice(-7)}`.toUpperCase()
  await callReducerBff(page, "create_account_account", [organizationId, {
    company_id: companyId,
    code,
    name: "Account deprecation readback fixture",
    user_type_id: userTypeId,
    currency_id: null,
    internal_type: { tag: "Expense" },
    internal_group: { tag: "Expense" },
    group_id: null,
    reconcile: false,
    tax_ids: [],
    note: null,
    opening_debit: 0,
    opening_credit: 0,
    allowed_journal_ids: [],
    non_trade: false,
    is_off_balance: false,
    metadata: JSON.stringify({ test: "account-deprecation-readback" }),
  }])

  const createdResponse = await page.request.get("/api/query/account-accounts")
  expect(createdResponse.ok()).toBe(true)
  const createdPayload = (await createdResponse.json()) as { data?: Array<Record<string, unknown>> }
  const accountId = scalarQueryId(
    (createdPayload.data ?? []).find((row) => row.code === code)?.id,
  )
  if (accountId == null) throw new Error(`deprecation fixture account not found: ${code}`)
  return accountId
}

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
    const accountId = await createDeprecationFixtureAccount(page)
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "accounts")

    const button = page.getByTestId(`account-toggle-deprecated-${accountId}`)
    await expect(button).toBeVisible()
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
