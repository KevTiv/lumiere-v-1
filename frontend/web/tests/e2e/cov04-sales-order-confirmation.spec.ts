import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { fetchDefaultCompanyId, signIn, smokeName } from "./helpers"
import {
  addLaptopLine,
  confirmOrderViaUi,
  createDraftSaleOrder,
  fetchOrderPickings,
} from "./sales-order-fixtures"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function confirmRequest(page: Page, companyId: number, orderId: number) {
  const { urlPath, init } = stdbBffCommandPost("confirm_sales_order", {
    companyId,
    orderId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe("COV-04 sale-order confirmation", { tag: ["@p0", "@cov04", "@unauthenticated"] }, () => {
  test("sales persona confirms the canonical order once and reader is denied", async ({ browser, page }) => {
    test.setTimeout(180_000)

    await signIn(page, "test@email.com", PERSONA_PASSWORD)
    const companyId = await fetchDefaultCompanyId(page)
    const orderId = await createDraftSaleOrder(page, smokeName("cov04-confirm"))
    await addLaptopLine(page, orderId, "1")
    expect(await fetchOrderPickings(page, orderId)).toEqual([])

    const salesContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const salesPage = await salesContext.newPage()
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()

    try {
      await signIn(salesPage, "fixture.sales@example.test", PERSONA_PASSWORD)
      await confirmOrderViaUi(salesPage, orderId)

      const confirmedPickings = await fetchOrderPickings(page, orderId)
      expect(confirmedPickings).toHaveLength(1)

      const staleReplay = await confirmRequest(salesPage, companyId, orderId)
      expect(staleReplay.status()).toBe(422)
      expect(await fetchOrderPickings(page, orderId)).toEqual(confirmedPickings)

      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denial = await confirmRequest(readerPage, companyId, orderId)
      expect(denial.status()).toBe(403)
      expect(await fetchOrderPickings(page, orderId)).toEqual(confirmedPickings)
    } finally {
      await readerContext.close()
      await salesContext.close()
    }
  })
})
