import { expect, test } from "@playwright/test"

import {
  chooseFirstOption,
  expectNoAppError,
  fetchDefaultCompanyId,
  fillField,
  openEntityCreate,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"

function unwrapQueryValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if ("some" in record) return unwrapQueryValue(record.some)
    if ("none" in record) return null
  }
  return value
}

function idOf(value: unknown): number | null {
  const raw = unwrapQueryValue(value)
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw === "bigint") return Number(raw)
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

test.describe("Accounting update mutations", { tag: ["@p0", "@phase-3"] }, () => {
  test("creates a tax and persists company_id FK with distinctive amount", async ({ page }) => {
    test.setTimeout(120_000)

    const taxName = smokeName("ri-tax")
    const companyId = await fetchDefaultCompanyId(page)

    await openEntityCreate(page, "/accounting", "accounting", "taxes", "new-tax")
    await fillField(page, "name", taxName)
    await fillField(page, "amount", "12.5")
    await chooseFirstOption(page, "typeTaxUse")

    const [createTaxRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_account_tax") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-tax"),
    ])
    expect(createTaxRes.ok()).toBe(true)

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/account-taxes")
          if (!res.ok()) return null
          const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
          const row = (json.data ?? []).find(
            (tax) => String(unwrapQueryValue(tax.name) ?? "") === taxName,
          )
          if (!row) return null
          const persistedCompanyId = idOf(row.companyId ?? row.company_id)
          const amount = Number(unwrapQueryValue(row.amount))
          if (persistedCompanyId !== companyId || amount !== 12.5) return null
          return { companyId: persistedCompanyId, amount }
        },
        { timeout: 30_000 },
      )
      .toEqual({ companyId, amount: 12.5 })

    await expectNoAppError(page)
  })

  test("deactivates a payment term via pt-deactivate and update_payment_term reducer", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const termName = smokeName("mut-term")

    await openEntityCreate(page, "/accounting", "accounting", "payment-terms", "new-payment-term")
    await fillField(page, "name", termName)
    const [createTermRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_payment_term") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-payment-term"),
    ])
    expect(createTermRes.ok()).toBe(true)
    await expect(page.getByText(termName).first()).toBeVisible({ timeout: 30_000 })

    await selectEntityRowByText(page, termName)
    await waitForEntityActionEnabled(page, "entity-action-pt-deactivate")

    const [updateTermRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/update_payment_term") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-pt-deactivate").click(),
    ])
    expect(updateTermRes.ok()).toBe(true)

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/account-payment-terms")
          if (!res.ok()) return null
          const json = (await res.json()) as {
            data?: Array<{ id?: unknown; name?: string; isActive?: boolean; is_active?: boolean }>
          }
          const row = (json.data ?? []).find((term) => String(term.name ?? "") === termName)
          if (!row) return null
          return row.isActive ?? row.is_active ?? null
        },
        { timeout: 30_000 },
      )
      .toBe(false)

    await expectNoAppError(page)
  })
})
