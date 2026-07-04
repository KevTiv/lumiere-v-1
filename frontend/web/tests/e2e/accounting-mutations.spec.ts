import { expect, test } from "@playwright/test"

import {
  expectNoAppError,
  fillField,
  openEntityCreate,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"

test.describe("Accounting update mutations", { tag: ["@p0", "@phase-3"] }, () => {
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
          const res = await page.request.get("/api/query/payment-terms")
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
